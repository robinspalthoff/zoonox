import { createHash } from "crypto";
import type { DocumentSource } from "@prisma/client";
import { db } from "@/lib/db";
import { storage, buildDocumentKey } from "@/lib/storage";
import { sniffContentType } from "@/lib/storage/sniff";
import { processDocument } from "@/lib/ocr/process-document";

export const UPLOAD_MAX_FILE_SIZE = 10 * 1024 * 1024;
export const UPLOAD_ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
] as const;

export type CreateDocumentFailure =
  | { ok: false; status: 400; error: string };

export type CreateDocumentSuccess = {
  ok: true;
  document: Awaited<ReturnType<typeof persistDocument>>;
};

type Args = {
  tenantId: string;
  userId: string | null;
  fileName: string;
  fileType: string;
  size: number;
  buffer: Buffer;
  // Eingangskanal — informativ für das Quell-Badge. Default: MANUAL.
  source?: DocumentSource;
};

async function persistDocument(args: {
  tenantId: string;
  userId: string | null;
  fileName: string;
  sniffedType: string;
  size: number;
  storagePath: string;
  fileHash: string;
  source: DocumentSource;
}) {
  return db.document.create({
    data: {
      tenantId: args.tenantId,
      fileName: args.fileName,
      fileType: args.sniffedType,
      fileSize: args.size,
      storagePath: args.storagePath,
      fileHash: args.fileHash,
      status: "PENDING",
      source: args.source,
      uploadedById: args.userId,
    },
    include: {
      uploadedBy: { select: { firstName: true, lastName: true } },
    },
  });
}

export async function createDocumentFromUpload(
  args: Args,
): Promise<CreateDocumentSuccess | CreateDocumentFailure> {
  if (!UPLOAD_ACCEPTED_TYPES.includes(args.fileType as (typeof UPLOAD_ACCEPTED_TYPES)[number])) {
    return {
      ok: false,
      status: 400,
      error: `File type ${args.fileType} not supported. Accepted: PDF, PNG, JPG.`,
    };
  }
  if (args.size > UPLOAD_MAX_FILE_SIZE) {
    return { ok: false, status: 400, error: "File too large. Maximum size is 10 MB." };
  }

  const sniffedType = sniffContentType(args.buffer);
  if (!sniffedType) {
    return {
      ok: false,
      status: 400,
      error: "File content not recognized. Accepted: PDF, PNG, JPG.",
    };
  }
  if (sniffedType !== args.fileType && !(sniffedType === "image/jpeg" && args.fileType === "image/jpg")) {
    console.warn(
      `[documents] Upload content-type mismatch: header="${args.fileType}" sniffed="${sniffedType}"`,
    );
  }

  const storagePath = buildDocumentKey(args.tenantId, args.fileName);
  const fileHash = createHash("sha256").update(args.buffer).digest("hex");
  await storage.put(storagePath, args.buffer, sniffedType);

  const document = await persistDocument({
    tenantId: args.tenantId,
    userId: args.userId,
    fileName: args.fileName,
    sniffedType,
    size: args.size,
    storagePath,
    fileHash,
    source: args.source ?? "MANUAL",
  });

  if (process.env.MISTRAL_API_KEY || process.env.OPENROUTER_API_KEY) {
    void processDocument(document.id);
  }

  return { ok: true, document };
}

export function serializeDocumentForApi(doc: Awaited<ReturnType<typeof persistDocument>>) {
  return {
    id: doc.id,
    fileName: doc.fileName,
    fileType: doc.fileType,
    fileSize: doc.fileSize,
    status: doc.status,
    category: doc.category,
    recognizedAmount: doc.recognizedAmount ? doc.recognizedAmount.toString() : null,
    recognizedDate: doc.recognizedDate ? doc.recognizedDate.toISOString() : null,
    recognizedSupplier: doc.recognizedSupplier,
    suggestedCategory: doc.suggestedCategory,
    createdAt: doc.createdAt.toISOString(),
    uploadedBy: doc.uploadedBy,
  };
}
