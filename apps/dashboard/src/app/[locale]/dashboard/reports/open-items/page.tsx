import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { formatCurrency, fmtDateShort } from "@/lib/format";
import {
  getOpenPayables,
  getOpenReceivables,
  sumTotals,
  type OpenPayable,
  type OpenReceivable,
} from "@/lib/accounting/open-items";
import { OpenItemsControls, type ContactOption, type OposMode } from "./open-items-controls";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports.openItems");
  return { title: t("pageTitle") };
}

function parseMode(raw: string | string[] | undefined): OposMode {
  if (raw === "RECEIVABLES" || raw === "PAYABLES" || raw === "BOTH") return raw;
  return "RECEIVABLES";
}

export default async function OpenItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; contactId?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const t = await getTranslations("reports.openItems");

  const sp = await searchParams;
  const mode = parseMode(sp.mode);
  const contactId = sp.contactId && sp.contactId.length > 0 ? sp.contactId : null;
  const now = new Date();

  const wantsReceivables = mode === "RECEIVABLES" || mode === "BOTH";
  const wantsPayables = mode === "PAYABLES" || mode === "BOTH";

  const [receivables, payables] = await Promise.all([
    wantsReceivables ? getOpenReceivables(tenantId, contactId, now) : Promise.resolve([] as OpenReceivable[]),
    wantsPayables ? getOpenPayables(tenantId, contactId, now) : Promise.resolve([] as OpenPayable[]),
  ]);

  // Kontakt-Dropdown: nur Kontakte, die im aktuellen Modus tatsächlich offene
  // Posten haben (oder die generell mit der passenden Rolle existieren, damit
  // der Filter auch dann sinnvoll ist, wenn ein einzelner Kontakt durchsucht
  // wird). Wir laden Kontakte mit passender Rolle aus der DB.
  const wantedRoles: ("CUSTOMER" | "SUPPLIER")[] = [];
  if (wantsReceivables) wantedRoles.push("CUSTOMER");
  if (wantsPayables) wantedRoles.push("SUPPLIER");
  const contacts = await db.contact.findMany({
    where: {
      tenantId,
      isActive: true,
      // hasSome erlaubt mehrere Rollen-Werte gleichzeitig — passt für den
      // BOTH-Modus, in dem sowohl Kunden als auch Lieferanten auftauchen.
      roles: { hasSome: wantedRoles },
    },
    select: { id: true, name: true, customerNumber: true, supplierNumber: true },
    orderBy: { name: "asc" },
  });

  const contactOptions: ContactOption[] = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    identifier:
      mode === "PAYABLES" ? c.supplierNumber
      : mode === "RECEIVABLES" ? c.customerNumber
      : c.customerNumber ?? c.supplierNumber,
  }));

  const receivablesTotal = sumTotals(receivables);
  const payablesTotal = sumTotals(payables);
  const net = receivablesTotal - payablesTotal;

  return (
    <div className="space-y-6 p-6 opos-print-root">
      <PrintStyles />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="text-muted-foreground text-sm mt-1 no-print">{t("subtitle")}</p>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums shrink-0 print-only">
          {t("summary.asOf")} {fmtDateShort(now.toISOString())}
        </p>
      </div>

      <OpenItemsControls mode={mode} contactId={contactId} contactOptions={contactOptions} />

      {wantsReceivables && (
        <ReceivablesSection
          title={t("section.receivables")}
          items={receivables}
          emptyMessage={t("empty.receivables")}
          headers={{
            number: t("table.number"),
            date: t("table.date"),
            dueDate: t("table.dueDate"),
            contact: t("table.contact"),
            contactNumber: t("table.contactNumber"),
            amount: t("table.amount"),
            daysOverdue: t("table.daysOverdue"),
          }}
          totalLabel={t("summary.fromCustomers")}
          total={receivablesTotal}
        />
      )}

      {wantsPayables && (
        <PayablesSection
          title={t("section.payables")}
          items={payables}
          emptyMessage={t("empty.payables")}
          headers={{
            number: t("table.number"),
            date: t("table.date"),
            dueDate: t("table.dueDate"),
            contact: t("table.contact"),
            contactNumber: t("table.contactNumber"),
            amount: t("table.amount"),
            daysOverdue: t("table.daysOverdue"),
          }}
          totalLabel={t("summary.toSuppliers")}
          total={payablesTotal}
        />
      )}

      <SummaryBlock
        title={t("summary.title")}
        receivablesLabel={t("summary.fromCustomers")}
        receivables={receivablesTotal}
        payablesLabel={t("summary.toSuppliers")}
        payables={payablesTotal}
        netLabel={t("summary.net")}
        net={net}
        showReceivables={wantsReceivables}
        showPayables={wantsPayables}
        showNet={mode === "BOTH"}
      />
    </div>
  );
}

// ─── Sections ───────────────────────────────────────────────────────────────

interface Headers {
  number: string;
  date: string;
  dueDate: string;
  contact: string;
  contactNumber: string;
  amount: string;
  daysOverdue: string;
}

function ReceivablesSection({
  title, items, emptyMessage, headers, totalLabel, total,
}: {
  title: string;
  items: OpenReceivable[];
  emptyMessage: string;
  headers: Headers;
  totalLabel: string;
  total: number;
}) {
  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/40">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">{headers.number}</th>
                <th className="text-left px-4 py-2 font-medium">{headers.date}</th>
                <th className="text-left px-4 py-2 font-medium">{headers.dueDate}</th>
                <th className="text-left px-4 py-2 font-medium">{headers.contactNumber}</th>
                <th className="text-left px-4 py-2 font-medium">{headers.contact}</th>
                <th className="text-right px-4 py-2 font-medium">{headers.daysOverdue}</th>
                <th className="text-right px-4 py-2 font-medium">{headers.amount}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.invoiceId} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    <Link href={`/dashboard/invoices/${it.invoiceId}`} className="text-primary hover:underline">
                      {it.number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{fmtDateShort(it.issueDate.toISOString())}</td>
                  <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
                    {it.dueDate ? fmtDateShort(it.dueDate.toISOString()) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{it.contact.customerNumber ?? "—"}</td>
                  <td className="px-4 py-2.5 text-foreground">
                    <Link href={`/dashboard/contacts/${it.contact.id}`} className="hover:text-primary">
                      {it.contact.name}
                    </Link>
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${it.daysOverdue > 0 ? "text-foreground font-medium" : "text-muted-foreground"} ${it.daysOverdue > 90 ? "text-destructive" : ""}`}>
                    {it.daysOverdue > 0 ? `+${it.daysOverdue}` : it.daysOverdue}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-foreground">
                    {formatCurrency(it.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/40 font-semibold">
                <td className="px-4 py-3 text-foreground" colSpan={6}>
                  {totalLabel}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-foreground">
                  {formatCurrency(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

function PayablesSection({
  title, items, emptyMessage, headers, totalLabel, total,
}: {
  title: string;
  items: OpenPayable[];
  emptyMessage: string;
  headers: Headers;
  totalLabel: string;
  total: number;
}) {
  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/40">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">{headers.number}</th>
                <th className="text-left px-4 py-2 font-medium">{headers.date}</th>
                <th className="text-left px-4 py-2 font-medium">{headers.dueDate}</th>
                <th className="text-left px-4 py-2 font-medium">{headers.contactNumber}</th>
                <th className="text-left px-4 py-2 font-medium">{headers.contact}</th>
                <th className="text-right px-4 py-2 font-medium">{headers.daysOverdue}</th>
                <th className="text-right px-4 py-2 font-medium">{headers.amount}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.documentId} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    <Link href={`/dashboard/documents/${it.documentId}`} className="text-primary hover:underline">
                      {it.documentNumber ?? it.fileName}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{fmtDateShort(it.date.toISOString())}</td>
                  <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
                    {it.dueDate ? fmtDateShort(it.dueDate.toISOString()) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{it.contact?.supplierNumber ?? "—"}</td>
                  <td className="px-4 py-2.5 text-foreground">
                    {it.contact ? (
                      <Link href={`/dashboard/contacts/${it.contact.id}`} className="hover:text-primary">
                        {it.contact.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground italic">—</span>
                    )}
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${it.daysOverdue > 0 ? "text-foreground font-medium" : "text-muted-foreground"} ${it.daysOverdue > 90 ? "text-destructive" : ""}`}>
                    {it.daysOverdue > 0 ? `+${it.daysOverdue}` : it.daysOverdue}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-foreground">
                    {formatCurrency(it.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/40 font-semibold">
                <td className="px-4 py-3 text-foreground" colSpan={6}>
                  {totalLabel}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-foreground">
                  {formatCurrency(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function SummaryBlock({
  title, receivablesLabel, receivables, payablesLabel, payables, netLabel, net,
  showReceivables, showPayables, showNet,
}: {
  title: string;
  receivablesLabel: string;
  receivables: number;
  payablesLabel: string;
  payables: number;
  netLabel: string;
  net: number;
  showReceivables: boolean;
  showPayables: boolean;
  showNet: boolean;
}) {
  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/40">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <div className="divide-y divide-border">
        {showReceivables && (
          <SummaryRow label={receivablesLabel} value={receivables} />
        )}
        {showPayables && (
          <SummaryRow label={payablesLabel} value={payables} />
        )}
        {showNet && (
          <SummaryRow label={netLabel} value={net} emphasize />
        )}
      </div>
    </section>
  );
}

function SummaryRow({
  label, value, emphasize,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between px-5 py-3 ${emphasize ? "bg-muted/30" : ""}`}>
      <p className={`text-sm ${emphasize ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {label}
      </p>
      <p className={`tabular-nums ${emphasize ? "text-lg font-bold text-foreground" : "text-base font-medium text-foreground"} ${value < 0 ? "text-destructive" : ""}`}>
        {formatCurrency(value)}
      </p>
    </div>
  );
}

// ─── Print styles ───────────────────────────────────────────────────────────
//
// Tailwind reicht für die meisten Layout-Klassen, aber Print braucht globale
// Regeln, die Side-Effects auf <body>/Sidebar/Header haben. Wir injizieren
// sie inline pro Page — keine globale styles.css-Verschmutzung.
function PrintStyles() {
  return (
    <style>{`
      .print-only { display: none; }
      @media print {
        @page { size: A4 portrait; margin: 14mm; }
        body { background: #fff !important; color: #000 !important; }
        aside, header, nav, .no-print { display: none !important; }
        main, [data-shell-main] { padding: 0 !important; margin: 0 !important; max-width: 100% !important; }
        .opos-print-root { padding: 0 !important; }
        .opos-print-root a { color: #000 !important; text-decoration: none !important; }
        .opos-print-root section { box-shadow: none !important; border-color: #ccc !important; page-break-inside: avoid; }
        .opos-print-root thead { background: #f4f4f4 !important; }
        .opos-print-root tfoot { background: #f4f4f4 !important; }
        .print-only { display: block !important; }
      }
    `}</style>
  );
}
