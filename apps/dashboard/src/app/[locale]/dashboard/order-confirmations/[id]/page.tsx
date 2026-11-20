import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import {
  User, ExternalLink, ChevronLeft, ChevronRight, ClipboardList, Receipt,
} from "lucide-react";
import { OCActions } from "./oc-actions";
import { InvoicePreviewPanel } from "../../invoices/[id]/invoice-preview-panel";
import { BusinessDocPreview } from "@/components/pdf/business-doc-preview";
import { OC_STATUS_CLASSES, OC_STATUS_DOT } from "@/lib/order-confirmations/status";
import { formatCurrency } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const oc = await db.orderConfirmation.findUnique({ where: { id }, select: { number: true } });
  return { title: oc?.number ?? "Auftragsbestätigung" };
}

function fmtDate(d: Date | string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(d).toLocaleDateString("de-DE", opts ?? { day: "2-digit", month: "long", year: "numeric" });
}

function Card({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-border/70 rounded-xl overflow-hidden ${className}`}>
      {title && (
        <div className="px-4 py-2 border-b border-border/70 bg-muted/40">
          <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
        </div>
      )}
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-foreground text-right">{children}</span>
    </div>
  );
}

export default async function OCDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id, locale } = await params;
  const { tenantId } = await requireTenant();
  const t = await getTranslations("orderConfirmations");

  const [oc, settings] = await Promise.all([
    db.orderConfirmation.findUnique({
      where: { id, tenantId },
      include: {
        contact: true,
        lineItems: { orderBy: { position: "asc" } },
        quote:    { select: { id: true, number: true } },
        invoices: { select: { id: true, number: true } },
      },
    }),
    db.companySettings.findUnique({ where: { tenantId } }),
  ]);
  if (!oc) notFound();

  const [prev, next] = await Promise.all([
    db.orderConfirmation.findFirst({
      where: { tenantId, createdAt: { lt: oc.createdAt } },
      orderBy: { createdAt: "desc" }, select: { id: true, number: true },
    }),
    db.orderConfirmation.findFirst({
      where: { tenantId, createdAt: { gt: oc.createdAt } },
      orderBy: { createdAt: "asc" }, select: { id: true, number: true },
    }),
  ]);

  const taxGroups: Record<number, number> = {};
  for (const item of oc.lineItems) {
    const tax = Number(item.amount) * (item.vatRate / 100);
    taxGroups[item.vatRate] = (taxGroups[item.vatRate] ?? 0) + tax;
  }

  const statusClass = OC_STATUS_CLASSES[oc.status];
  const statusDot   = OC_STATUS_DOT[oc.status];
  const pdfUrl      = `/api/order-confirmations/${oc.id}/pdf?locale=${locale}`;
  const hasInvoice = oc.invoices.length > 0;

  const previewDoc = {
    number: oc.number,
    issueDate: oc.issueDate,
    deadlineDate: oc.deliveryDate,
    deadlineLabel: oc.deliveryDate ? t("fields.deliveryDate") : undefined,
    serviceDate: oc.serviceDate,
    serviceDateEnd: oc.serviceDateEnd,
    notes: oc.notes,
    introText: oc.introText,
    vatRegulation: oc.vatRegulation,
    subtotal: oc.subtotal,
    taxAmount: oc.taxAmount,
    total: oc.total,
    contact: oc.contact,
    lineItems: oc.lineItems.map((li) => ({
      id: li.id, position: li.position,
      description: li.description, quantity: li.quantity, unit: li.unit,
      unitPrice: li.unitPrice, vatRate: li.vatRate, amount: li.amount,
    })),
  };

  return (
    <div className="flex overflow-hidden" style={{ height: "calc(100vh - 4.5rem)" }}>
      <InvoicePreviewPanel invoiceNumber={oc.number} pdfUrl={pdfUrl} backHref="/dashboard/order-confirmations">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <BusinessDocPreview doc={previewDoc as any} docType="ORDER_CONFIRMATION" settings={settings} locale={locale} />
      </InvoicePreviewPanel>

      <div className="w-[400px] shrink-0 flex flex-col overflow-y-auto border-l border-border bg-background">
        <div className="sticky top-0 z-10 px-5 pt-5 pb-4 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-1">
              {prev ? (
                <Link href={`/dashboard/order-confirmations/${prev.id}`} title={`Vorherige: ${prev.number}`}
                  className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-muted transition-colors">
                  <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                </Link>
              ) : <span className="w-7 h-7" />}
              {next ? (
                <Link href={`/dashboard/order-confirmations/${next.id}`} title={`Nächste: ${next.number}`}
                  className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-muted transition-colors">
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </Link>
              ) : <span className="w-7 h-7" />}
            </div>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${statusClass}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
              {t(`status.${oc.status}`)}
            </span>
          </div>

          <h1 className="text-xl font-bold text-foreground tracking-tight mb-0.5">{oc.number}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {fmtDate(oc.issueDate)}
            {oc.deliveryDate && (
              <> · {t("fields.deliveryDate")} {fmtDate(oc.deliveryDate, { day: "2-digit", month: "short", year: "numeric" })}</>
            )}
          </p>
        </div>

        <div className="flex-1 px-4 py-4 space-y-3">
          <Card>
            <Link href={`/dashboard/contacts/${oc.contactId}`} className="flex items-center gap-3 mb-4 group" title="Zum Kunden">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                <User className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate leading-tight group-hover:text-primary transition-colors">
                  {oc.contact.name}
                </p>
                {oc.contact.email && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{oc.contact.email}</p>
                )}
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </Link>

            <div className="pt-3 border-t border-border/60">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground shrink-0">{t("summary.total")}</span>
                <span className="text-2xl font-bold text-foreground tabular-nums tracking-tight text-right">
                  {formatCurrency(oc.total)}
                </span>
              </div>
              {Number(oc.taxAmount) > 0 && (
                <p className="text-xs text-muted-foreground mt-1 text-right">
                  inkl. <span className="tabular-nums">{formatCurrency(oc.taxAmount)}</span> MwSt.{" "}
                  · Netto <span className="tabular-nums">{formatCurrency(oc.subtotal)}</span>
                </p>
              )}
            </div>
          </Card>

          <Card title="Aktionen">
            <OCActions
              ocId={oc.id}
              ocNumber={oc.number}
              currentStatus={oc.status}
              hasInvoice={hasInvoice}
              clientEmail={oc.contact.email}
              vertical
            />
          </Card>

          <Card title={t("form.details")}>
            <Row label={t("fields.issueDate")}>{fmtDate(oc.issueDate)}</Row>
            {oc.deliveryDate && <Row label={t("fields.deliveryDate")}>{fmtDate(oc.deliveryDate)}</Row>}
            {oc.serviceDate && (
              <Row label={oc.serviceDateEnd ? t("fields.serviceDateEnd") : t("fields.serviceDate")}>
                {oc.serviceDateEnd
                  ? `${fmtDate(oc.serviceDate, { day: "2-digit", month: "2-digit", year: "numeric" })} – ${fmtDate(oc.serviceDateEnd, { day: "2-digit", month: "2-digit", year: "numeric" })}`
                  : fmtDate(oc.serviceDate)}
              </Row>
            )}
            {oc.contact.vatId && <Row label="USt-IdNr. Kunde">{oc.contact.vatId}</Row>}
          </Card>

          {(oc.quote || hasInvoice) && (
            <Card title="Verknüpfungen">
              <div className="space-y-2.5">
                {oc.quote && (
                  <div className="flex items-center gap-2.5 py-1.5">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <ClipboardList className="w-3 h-3 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">{t("transactions.fromQuote")}</p>
                      <Link href={`/dashboard/quotes/${oc.quote.id}`} className="text-xs font-semibold text-primary hover:underline">
                        {oc.quote.number}
                      </Link>
                    </div>
                  </div>
                )}
                {oc.invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-2.5 py-1.5">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <Receipt className="w-3 h-3 text-emerald-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">{t("transactions.convertedToInvoice")}</p>
                      <Link href={`/dashboard/invoices/${inv.id}`} className="text-xs font-semibold text-emerald-500 hover:underline">
                        {inv.number}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title={t("lineItems.title")}>
            <div className="space-y-3">
              {oc.lineItems.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground leading-snug">{item.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                      {Number(item.quantity).toLocaleString("de-DE")}{item.unit ? ` ${item.unit}` : ""} × {formatCurrency(item.unitPrice)}
                      {item.vatRate > 0 && <span className="ml-1 opacity-70">· {item.vatRate} %</span>}
                    </p>
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-foreground shrink-0 pt-0.5">
                    {formatCurrency(item.amount)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-border/60 space-y-1">
              <Row label={t("summary.subtotal")}>{formatCurrency(oc.subtotal)}</Row>
              {Object.entries(taxGroups).filter(([, v]) => v > 0.001).map(([rate, amount]) => (
                <Row key={rate} label={`MwSt. ${rate} %`}>{formatCurrency(amount)}</Row>
              ))}
              <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-border/60">
                <span className="text-xs font-bold text-foreground shrink-0">{t("summary.total")}</span>
                <span className="text-sm font-bold tabular-nums text-foreground">{formatCurrency(oc.total)}</span>
              </div>
            </div>
          </Card>

          {oc.notes && (
            <Card title={t("fields.notes")}>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{oc.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
