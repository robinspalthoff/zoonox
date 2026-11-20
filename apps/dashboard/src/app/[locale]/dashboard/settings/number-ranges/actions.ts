"use server";

import { revalidatePath } from "next/cache";
import type { NumberRangeType } from "@prisma/client";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";
import { createAuditLog } from "@/lib/audit";
import { derivesYearlyReset, previewNumber } from "@/lib/number-ranges";

export type SaveNumberRangeInput = {
  type: NumberRangeType;
  format: string;
  nextNumber: number;
  minDigits: number;
};

export type SaveNumberRangeResult =
  | { success: true; preview: string }
  | {
      success: false;
      error: string;
      field?: "format" | "nextNumber" | "minDigits";
    };

function canEditSettings(role: string, tenantRole: string): boolean {
  return (
    ["SUPER_ADMIN", "ADMIN"].includes(role) ||
    ["OWNER", "ADMIN"].includes(tenantRole)
  );
}

export async function saveNumberRange(
  input: SaveNumberRangeInput,
): Promise<SaveNumberRangeResult> {
  const t = await requireTenant();
  if (!canEditSettings(t.role, t.tenantRole)) {
    return { success: false, error: "Insufficient permissions." };
  }

  const format = input.format.trim();
  const nextNumber = Math.floor(Number(input.nextNumber));
  const minDigits = Math.floor(Number(input.minDigits));

  if (!format) {
    return { success: false, error: "Format darf nicht leer sein.", field: "format" };
  }
  if (!format.includes("{NUMBER}")) {
    return {
      success: false,
      error: "Das Format muss den Platzhalter {NUMBER} enthalten.",
      field: "format",
    };
  }
  if (!Number.isFinite(nextNumber) || nextNumber < 1) {
    return {
      success: false,
      error: "Nächste Nummer muss eine ganze Zahl ≥ 1 sein.",
      field: "nextNumber",
    };
  }
  if (!Number.isFinite(minDigits) || minDigits < 1 || minDigits > 10) {
    return {
      success: false,
      error: "Mindestlänge muss zwischen 1 und 10 liegen.",
      field: "minDigits",
    };
  }

  // The split prefix field is no longer surfaced — the user types the full
  // format directly (à la sevDesk). We persist prefix="" so legacy {PREFIX}
  // tokens (which expand to "") vanish on the next save. Yearly reset is
  // derived from whether the format references the year.
  const yearlyReset = derivesYearlyReset(format);

  const existing = await db.numberRange.findUnique({
    where: { tenantId_type: { tenantId: t.tenantId, type: input.type } },
  });

  const saved = await db.numberRange.upsert({
    where: { tenantId_type: { tenantId: t.tenantId, type: input.type } },
    update: { format, prefix: "", nextNumber, minDigits, yearlyReset },
    create: {
      tenantId: t.tenantId,
      type: input.type,
      format,
      prefix: "",
      nextNumber,
      minDigits,
      yearlyReset,
      lastYear: null,
    },
  });

  await createAuditLog({
    action: "SETTINGS_CHANGED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "NumberRange",
    entityId: input.type,
    details: {
      type: input.type,
      before: existing
        ? {
            format: existing.format,
            prefix: existing.prefix,
            nextNumber: existing.nextNumber,
            minDigits: existing.minDigits,
            yearlyReset: existing.yearlyReset,
          }
        : null,
      after: { format, nextNumber, minDigits, yearlyReset },
    },
  });

  revalidatePath("/dashboard/settings/number-ranges");
  return {
    success: true,
    preview: previewNumber({
      format: saved.format,
      prefix: saved.prefix,
      minDigits: saved.minDigits,
      nextNumber: saved.nextNumber,
      yearlyReset: saved.yearlyReset,
      lastYear: saved.lastYear,
    }),
  };
}
