"use server";

import { db } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";
import { createAuditLog } from "@/lib/audit";
import { peekNumber, NUMBER_RANGE_DEFAULTS } from "@/lib/number-ranges";
import { revalidatePath } from "next/cache";
import type { ContactRole } from "@prisma/client";

export type ContactResult =
  | { success: true; id: string }
  | { success: false; error: string };

const ALL_ROLES: ContactRole[] = ["CUSTOMER", "SUPPLIER", "PARTNER", "OTHER"];

function parseRoles(formData: FormData): ContactRole[] {
  return formData
    .getAll("roles")
    .filter((r): r is string => typeof r === "string")
    .filter((r) => ALL_ROLES.includes(r as ContactRole)) as ContactRole[];
}

export async function upsertContact(formData: FormData): Promise<ContactResult> {
  const t = await requireTenant();
  if (!["SUPER_ADMIN", "ADMIN"].includes(t.role) && t.tenantRole !== "OWNER" && t.tenantRole !== "ADMIN") {
    return { success: false, error: "Insufficient permissions." };
  }

  const id = formData.get("id") as string | null;
  const name = (formData.get("name") as string)?.trim();
  if (!name) return { success: false, error: "Name is required." };

  const str = (key: string) => (formData.get(key) as string)?.trim() || null;
  const num = (key: string) => {
    const v = str(key);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const dec = (key: string) => {
    const v = str(key);
    if (v === null) return null;
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  const data = {
    name,
    customerNumber: str("customerNumber"),
    supplierNumber: str("supplierNumber"),
    roles: parseRoles(formData),
    contactSalutation: str("contactSalutation"),
    contactTitle: str("contactTitle"),
    contactFirstName: str("contactFirstName"),
    contactLastName: str("contactLastName"),
    contactPosition: str("contactPosition"),
    address: str("address"),
    city: str("city"),
    zip: str("zip"),
    country: str("country") || "DE",
    email: str("email"),
    phone: str("phone"),
    website: str("website"),
    iban: str("iban"),
    bic: str("bic"),
    vatId: str("vatId"),
    taxId: str("taxId"),
    notes: str("notes"),
    paymentTermDays: num("paymentTermDays"),
    discountDays: num("discountDays"),
    discountPercent: dec("discountPercent"),
  };

  if (id) {
    // Update muss tenantId-Scope verifizieren
    const result = await db.contact.updateMany({
      where: { id, tenantId: t.tenantId },
      data,
    });
    if (result.count === 0) return { success: false, error: "Not found." };
    await createAuditLog({ action: "CONTACT_UPDATED", tenantId: t.tenantId, userId: t.userId, entityType: "Contact", entityId: id });
    revalidatePath("/dashboard/contacts");
    return { success: true, id };
  } else {
    // Create + counter-bump share a transaction. When the user keeps the
    // suggested customer number (or types an even higher one), the CUSTOMER
    // range advances past it so the next suggestion is fresh. Manually
    // entered non-numeric or smaller numbers leave the counter untouched.
    const contact = await db.$transaction(async (tx) => {
      const created = await tx.contact.create({
        data: { ...data, tenantId: t.tenantId },
      });
      if (data.customerNumber && /^\d+$/.test(data.customerNumber)) {
        await bumpContactCounter(tx, t.tenantId, "CUSTOMER", parseInt(data.customerNumber, 10));
      }
      if (data.supplierNumber && /^\d+$/.test(data.supplierNumber)) {
        await bumpContactCounter(tx, t.tenantId, "SUPPLIER", parseInt(data.supplierNumber, 10));
      }
      return created;
    });
    await createAuditLog({ action: "CONTACT_CREATED", tenantId: t.tenantId, userId: t.userId, entityType: "Contact", entityId: contact.id });
    revalidatePath("/dashboard/contacts");
    return { success: true, id: contact.id };
  }
}

/**
 * Liefert die nächste freie Kundennummer entsprechend dem konfigurierten
 * CUSTOMER-Nummernkreis. Reine Vorschau (bumpt den Zähler nicht) — der
 * tatsächliche Counter-Advance passiert beim Speichern eines Kontakts
 * über bumpCustomerCounterIfHigher.
 */
export async function getNextCustomerNumber(): Promise<string> {
  const t = await requireTenant();
  return peekNumber(t.tenantId, "CUSTOMER");
}

/** Liefert die nächste freie Lieferantennummer (Kreditorennummer). */
export async function getNextSupplierNumber(): Promise<string> {
  const t = await requireTenant();
  return peekNumber(t.tenantId, "SUPPLIER");
}

/**
 * Wenn der Nutzer eine Kunden- oder Lieferantennummer manuell eintippt, soll
 * der zugehörige Nummernkreis-Zähler bei Bedarf hochgezogen werden — damit
 * das nächste Anlegen wieder eine frische Vorschau zeigt. Niedrigere Zahlen
 * (bewusst gewählt) lassen den Zähler unberührt.
 */
async function bumpContactCounter(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  tenantId: string,
  type: "CUSTOMER" | "SUPPLIER",
  typed: number,
): Promise<void> {
  const range = await tx.numberRange.findUnique({
    where: { tenantId_type: { tenantId, type } },
  });
  if (range) {
    if (range.nextNumber <= typed) {
      await tx.numberRange.update({
        where: { tenantId_type: { tenantId, type } },
        data: { nextNumber: typed + 1 },
      });
    }
    return;
  }
  const def = NUMBER_RANGE_DEFAULTS[type];
  await tx.numberRange.create({
    data: {
      tenantId,
      type,
      format: def.format,
      prefix: def.prefix,
      nextNumber: typed + 1,
      minDigits: def.minDigits,
      yearlyReset: def.yearlyReset,
      lastYear: null,
    },
  });
}

/**
 * Löscht einen Kontakt endgültig. Kontakte mit verknüpften Rechnungen
 * (oder wiederkehrenden Rechnungen) dürfen nicht gelöscht werden — der
 * Aufrufer soll sie stattdessen deaktivieren.
 */
export async function deleteContact(id: string): Promise<{ success: boolean; error?: string }> {
  const t = await requireTenant();
  if (!["SUPER_ADMIN", "ADMIN"].includes(t.role) && t.tenantRole !== "OWNER" && t.tenantRole !== "ADMIN") {
    return { success: false, error: "Insufficient permissions." };
  }
  const contact = await db.contact.findFirst({
    where: { id, tenantId: t.tenantId },
    select: { _count: { select: { invoices: true, recurringInvoices: true } } },
  });
  if (!contact) return { success: false, error: "Not found." };
  if (contact._count.invoices > 0 || contact._count.recurringInvoices > 0) {
    return { success: false, error: "HAS_INVOICES" };
  }
  await db.contact.delete({ where: { id } });
  await createAuditLog({
    action: "CONTACT_DELETED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Contact",
    entityId: id,
  });
  revalidatePath("/dashboard/contacts");
  return { success: true };
}

export async function toggleContactActive(id: string): Promise<{ success: boolean }> {
  const t = await requireTenant();
  if (!["SUPER_ADMIN", "ADMIN"].includes(t.role) && t.tenantRole !== "OWNER" && t.tenantRole !== "ADMIN") {
    return { success: false };
  }
  const contact = await db.contact.findFirst({ where: { id, tenantId: t.tenantId } });
  if (!contact) return { success: false };
  await db.contact.update({ where: { id }, data: { isActive: !contact.isActive } });
  await createAuditLog({
    action: "CONTACT_UPDATED",
    tenantId: t.tenantId,
    userId: t.userId,
    entityType: "Contact",
    entityId: id,
    details: { isActive: !contact.isActive },
  });
  revalidatePath("/dashboard/contacts");
  return { success: true };
}
