// Cloudflare R2 adapter (S3-API-compatible).
//
// R2 quirks vs. native AWS S3:
//   - region must be "auto" (otherwise SignatureV4 fails)
//   - endpoint is per-account: https://<accountid>.r2.cloudflarestorage.com
//   - no Object Tagging — don't pass x-amz-tagging headers
//   - presigned URL TTL max 7 days
//
// All calls are scoped to a single bucket from R2_BUCKET_NAME. Tenant
// isolation lives in the key prefix (see keys.ts) — there is no
// per-tenant bucket; the application layer enforces auth before each
// storage call.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectRetentionCommand,
  NoSuchKey,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageAdapter } from "./types";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `[storage/r2] Missing env ${name}. Set STORAGE_DRIVER=local for dev, ` +
        `or supply R2 credentials. See .env.example.`,
    );
  }
  return v;
}

let _client: S3Client | null = null;
let _bucket: string | null = null;

function client(): S3Client {
  if (_client) return _client;
  const endpoint =
    process.env.S3_ENDPOINT ??
    `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;

  // R2 accepts either R2_ACCESS_KEY_ID or R2_ACCESS_KEY (Cloudflare's UI
  // labels the field "Access Key ID" but their `wrangler` outputs use
  // R2_ACCESS_KEY). Accept both for ergonomics.
  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? process.env.R2_ACCESS_KEY;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "[storage/r2] Missing R2_ACCESS_KEY(_ID) and/or R2_SECRET_ACCESS_KEY.",
    );
  }

  _client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    // R2 does not support the AWS request checksum trailer that newer
    // SDKs send by default; without this flag uploads of binary bodies
    // fail with "STREAMING-UNSIGNED-PAYLOAD-TRAILER not implemented".
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  _bucket = required("R2_BUCKET_NAME");
  return _client;
}

function bucket(): string {
  if (!_bucket) client();
  return _bucket!;
}

async function streamToBuffer(stream: unknown): Promise<Buffer> {
  // The S3 SDK returns a Body whose concrete type differs by runtime.
  // Web ReadableStream → use .transformToByteArray helper if present;
  // Node Readable    → collect chunks.
  const body = stream as
    | { transformToByteArray?: () => Promise<Uint8Array> }
    | AsyncIterable<Uint8Array>;
  if (body && typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function") {
    const arr = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(arr);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export const r2Adapter: StorageAdapter = {
  async put(key, body, contentType, opts) {
    await client().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
        // GoBD: write-once retention applied atomically with the upload.
        ...(opts?.objectLock
          ? {
              ObjectLockMode: opts.objectLock.mode,
              ObjectLockRetainUntilDate: opts.objectLock.retainUntil,
            }
          : {}),
      }),
    );
  },

  async get(key) {
    try {
      const out = await client().send(
        new GetObjectCommand({ Bucket: bucket(), Key: key }),
      );
      if (!out.Body) return null;
      return await streamToBuffer(out.Body);
    } catch (e) {
      if (e instanceof NoSuchKey) return null;
      if (e instanceof S3ServiceException && e.name === "NoSuchKey") return null;
      // 404 sometimes surfaces as a generic 404 — be defensive.
      const code = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      if (code === 404) return null;
      throw e;
    }
  },

  async delete(key) {
    await client().send(
      new DeleteObjectCommand({ Bucket: bucket(), Key: key }),
    );
  },

  async exists(key) {
    try {
      await client().send(
        new HeadObjectCommand({ Bucket: bucket(), Key: key }),
      );
      return true;
    } catch (e) {
      const code = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      if (code === 404) return false;
      if (e instanceof S3ServiceException && e.name === "NotFound") return false;
      throw e;
    }
  },

  async signedUrl(key, ttlSec) {
    const cmd = new GetObjectCommand({ Bucket: bucket(), Key: key });
    return getSignedUrl(client(), cmd, { expiresIn: ttlSec });
  },

  async setRetention(key, lock) {
    await client().send(
      new PutObjectRetentionCommand({
        Bucket: bucket(),
        Key: key,
        Retention: {
          Mode: lock.mode,
          RetainUntilDate: lock.retainUntil,
        },
      }),
    );
  },
};
