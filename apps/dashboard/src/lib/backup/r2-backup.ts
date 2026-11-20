// Cross-region backup — primary R2 → secondary R2 bucket.
//
// Disaster recovery for GoBD-relevant data: an account lockout, a botched
// lifecycle rule or a region outage must not take the only copy with it.
// This job mirrors every object from the primary bucket into a second,
// independently-credentialled R2 bucket (ideally in a different region /
// Cloudflare account).
//
// The job is INERT until the BACKUP_R2_* env vars are set — it returns
// `{ skipped: true }` so the worker can schedule it unconditionally and the
// operator enables it later just by supplying credentials.
//
// Stored objects are immutable (Object Lock), so a key that already exists
// in the secondary with a matching byte size is treated as up-to-date and
// skipped. The secondary bucket SHOULD itself have Object Lock enabled with
// a default retention rule, so mirrored objects inherit GoBD immutability
// without this job having to replay per-object retention.

import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

export type R2BackupResult =
  | { skipped: true; reason: string }
  | {
      skipped: false;
      scanned: number;
      copied: number;
      upToDate: number;
      errors: { key: string; message: string }[];
    };

interface R2Target {
  client: S3Client;
  bucket: string;
}

function makeClient(
  accountId: string,
  accessKeyId: string,
  secretAccessKey: string,
  endpointOverride?: string,
): S3Client {
  return new S3Client({
    region: "auto",
    endpoint:
      endpointOverride ?? `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // R2 does not implement the AWS request-checksum trailer (see r2.ts).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** Resolve the primary R2 bucket from the app's existing R2_* env. */
function primaryTarget(): R2Target | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? process.env.R2_ACCESS_KEY;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accessKeyId || !secretAccessKey || !bucket) return null;
  if (!accountId && !process.env.S3_ENDPOINT) return null;
  return {
    client: makeClient(
      accountId ?? "",
      accessKeyId,
      secretAccessKey,
      process.env.S3_ENDPOINT,
    ),
    bucket,
  };
}

/**
 * Resolve the secondary backup bucket.
 *
 * `BACKUP_R2_BUCKET_NAME` is the opt-in switch — without it the job stays
 * inert. Account, credentials and endpoint each fall back to the primary
 * `R2_*` config when the `BACKUP_R2_*` equivalent is unset. That is
 * convenient when the secondary bucket lives in the same Cloudflare account,
 * though a separate account is preferable for true disaster recovery (see
 * docs/deployment.md).
 */
function secondaryTarget(): R2Target | null {
  const bucket = process.env.BACKUP_R2_BUCKET_NAME;
  if (!bucket) return null;

  const accountId =
    process.env.BACKUP_R2_ACCOUNT_ID ?? process.env.R2_ACCOUNT_ID;
  const accessKeyId =
    process.env.BACKUP_R2_ACCESS_KEY_ID ??
    process.env.BACKUP_R2_ACCESS_KEY ??
    process.env.R2_ACCESS_KEY_ID ??
    process.env.R2_ACCESS_KEY;
  const secretAccessKey =
    process.env.BACKUP_R2_SECRET_ACCESS_KEY ??
    process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.BACKUP_R2_ENDPOINT ?? process.env.S3_ENDPOINT;

  if (!accessKeyId || !secretAccessKey) return null;
  if (!accountId && !endpoint) return null;
  return {
    client: makeClient(accountId ?? "", accessKeyId, secretAccessKey, endpoint),
    bucket,
  };
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  const b = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
  } & AsyncIterable<Uint8Array>;
  if (typeof b?.transformToByteArray === "function") {
    return Buffer.from(await b.transformToByteArray());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of b) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Byte size of `key` in the secondary bucket, or null if it is absent. */
async function secondarySize(
  target: R2Target,
  key: string,
): Promise<number | null> {
  try {
    const head = await target.client.send(
      new HeadObjectCommand({ Bucket: target.bucket, Key: key }),
    );
    return head.ContentLength ?? null;
  } catch (e) {
    const code = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode;
    if (code === 404) return null;
    throw e;
  }
}

export async function runR2Backup(): Promise<R2BackupResult> {
  const secondary = secondaryTarget();
  if (!secondary) {
    return { skipped: true, reason: "BACKUP_R2_* not configured" };
  }
  const primary = primaryTarget();
  if (!primary) {
    return {
      skipped: true,
      reason: "primary R2 (R2_*) not configured — nothing to back up",
    };
  }
  if (secondary.bucket === primary.bucket) {
    return {
      skipped: true,
      reason:
        "BACKUP_R2_BUCKET_NAME equals R2_BUCKET_NAME — refusing to back up a bucket onto itself",
    };
  }

  let scanned = 0;
  let copied = 0;
  let upToDate = 0;
  const errors: { key: string; message: string }[] = [];

  let continuationToken: string | undefined;
  do {
    const page = await primary.client.send(
      new ListObjectsV2Command({
        Bucket: primary.bucket,
        ContinuationToken: continuationToken,
      }),
    );

    for (const obj of page.Contents ?? []) {
      const key = obj.Key;
      if (!key) continue;
      scanned++;
      try {
        const existing = await secondarySize(secondary, key);
        if (existing !== null && existing === obj.Size) {
          upToDate++;
          continue;
        }
        const src = await primary.client.send(
          new GetObjectCommand({ Bucket: primary.bucket, Key: key }),
        );
        const buf = await streamToBuffer(src.Body);
        await secondary.client.send(
          new PutObjectCommand({
            Bucket: secondary.bucket,
            Key: key,
            Body: buf,
            ContentType: src.ContentType ?? "application/octet-stream",
          }),
        );
        copied++;
      } catch (e) {
        errors.push({
          key,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return { skipped: false, scanned, copied, upToDate, errors };
}
