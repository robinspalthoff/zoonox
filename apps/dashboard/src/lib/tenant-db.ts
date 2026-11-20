// Tenant-aware Prisma Client
//
// Liefert eine Prisma-Instanz, die jede Query auf den übergebenen Tenant
// einschränkt. Schützt gegen versehentliches Daten-Leak zwischen Mandanten,
// auch wenn ein Bug eine where-Klausel vergisst.
//
// Modelle, die *direkt* einen `tenantId`-Foreign-Key haben, werden hier
// gelistet. Sub-Modelle (z. B. InvoiceLineItem, JournalLine) sind über ihren
// Parent geschützt — Direkt-Queries darauf sollten generell vermieden werden.
//
// Usage:
//   const tdb = getTenantDb(session.user.tenantId);
//   const invoices = await tdb.invoice.findMany();   // automatisch gefiltert
//   await tdb.invoice.create({ data: { number, ... } }); // tenantId wird gesetzt

import { Prisma } from "@prisma/client";
import { db } from "./db";

const TENANT_SCOPED_MODELS = new Set([
  "AuditLog",
  "BankAccount",
  "BankConnection",
  "BankTransaction",
  "CashbookEntry",
  "Client",
  "CompanySettings",
  "Document",
  "Invoice",
  "JournalEntry",
  "JournalSequence",
]);

type ReadOp = "findFirst" | "findFirstOrThrow" | "findMany" | "findUnique" | "findUniqueOrThrow" | "count" | "aggregate" | "groupBy";
type WriteOp = "create" | "createMany" | "createManyAndReturn" | "update" | "updateMany" | "upsert" | "delete" | "deleteMany";

function injectTenantWhere(where: unknown, tenantId: string): Record<string, unknown> {
  // Composite unique-Indizes (wie invoices_tenantId_number) verlangen
  // bereits eine spezielle Form. Wir mergen vorsichtig, ohne existierende
  // Bedingungen zu überschreiben.
  if (!where || typeof where !== "object") {
    return { tenantId };
  }
  const w = where as Record<string, unknown>;
  if ("tenantId" in w) return w;
  return { ...w, tenantId };
}

export function getTenantDb(tenantId: string) {
  if (!tenantId) {
    throw new Error("getTenantDb: tenantId is required");
  }

  return db.$extends({
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const op = operation as ReadOp | WriteOp;
          const a = (args ?? {}) as Record<string, unknown>;

          switch (op) {
            case "findFirst":
            case "findFirstOrThrow":
            case "findMany":
            case "findUnique":
            case "findUniqueOrThrow":
            case "count":
            case "aggregate":
            case "groupBy":
            case "updateMany":
            case "deleteMany":
            case "update":
            case "delete":
            case "upsert":
              a.where = injectTenantWhere(a.where, tenantId);
              break;

            case "create": {
              const data = (a.data ?? {}) as Record<string, unknown>;
              if (!("tenantId" in data) && !("tenant" in data)) {
                a.data = { ...data, tenantId };
              }
              break;
            }
            case "createMany":
            case "createManyAndReturn": {
              const data = a.data;
              if (Array.isArray(data)) {
                a.data = data.map((row) => {
                  const r = (row ?? {}) as Record<string, unknown>;
                  return "tenantId" in r ? r : { ...r, tenantId };
                });
              } else if (data && typeof data === "object") {
                const r = data as Record<string, unknown>;
                if (!("tenantId" in r)) a.data = { ...r, tenantId };
              }
              break;
            }
          }

          // upsert benötigt zusätzlich tenantId in create- und update-Daten
          if (op === "upsert") {
            const create = (a.create ?? {}) as Record<string, unknown>;
            if (!("tenantId" in create) && !("tenant" in create)) {
              a.create = { ...create, tenantId };
            }
          }

          return query(a);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof getTenantDb>;

// Komfort-Wrapper: Tenant-DB direkt aus der Session ziehen.
// Wirft, wenn kein aktiver Tenant — verhindert versehentliche Plain-DB-Nutzung.
import { auth } from "@/auth";

export async function tenantDbFromSession(): Promise<{ tdb: TenantDb; tenantId: string }> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    throw new Error("No active tenant in session");
  }
  return { tdb: getTenantDb(tenantId), tenantId };
}
