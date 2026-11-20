import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import {
  User, ExternalLink, ChevronLeft, ChevronRight, CheckCircle2, FileSignature, Receipt,
} from "lucide-react";
import { QuoteActions } from "./quote-actions";
import { InvoicePreviewPanel } from "../../invoices/[id]/invoice-preview-panel";
import { BusinessDocPreview } from "@/components/pdf/business-doc-preview";
import { QUOTE_STATUS_CLASSES, QUOTE_STATUS_DOT, isQuoteEffectivelyExpired } from "@/lib/quotes/status";
import { formatCurrency } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const quote = await db.quote.findUnique({ where: { id }, select: { number: true } });
  return { title: quote?.number ?? "Angebot" };
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

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id, locale } = await params;
  const { tenantId } = await requireTenant();
  const t = await getTranslations("quotes");

  const [quote, settings] = await Promise.all([
    db.quote.findUnique({
      where: { id, tenantId },
      include: {
        contact: true,
        lineItems: { orderBy: { position: "asc" } },
        orderConfirmations: { select: { id: true, number: true, issueDate: true } },
        invoices:           { select: { id: true, number: true, issueDate: true } },
      },
    }),
    db.companySettings.findUnique({ where: { tenantId } }),
  ]);
  if (!quote) notFound();

  const [prev, next] = await Promise.all([
    db.quote.findFirst({
      where: { tenantId, createdAt: { lt: quote.createdAt } },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true },
    }),
    db.quote.findFirst({
      where: { tenantId, createdAt: { gt: quote.createdAt } },
      orderBy: { createdAt: "asc" },
      select: { id: true, number: true },
    }),
  ]);

  const taxGroups: Record<number, number> = {};
  for (const item of quote.lineItems) {
    const tax = Number(item.amount) * (item.vatRate / 100);
    taxGroups[item.vatRate] = (taxGroups[item.vatRate] ?? 0) + tax;
  }

  const displayStatus = isQuoteEffectivelyExpired(quote.status, quote.validUntil) ? "EXPIRED" : quote.status;
  const statusClass = QUOTE_STATUS_CLASSES[displayStatus];
  const statusDot   = QUOTE_STATUS_DOT[displayStatus];
  const pdfUrl      = `/api/quotes/${quote.id}/pdf?locale=${locale}`;
  const converted = !!quote.convertedAt;
  const hasFollowUps = quote.orderConfirmations.length > 0 || quote.invoices.length > 0;

  const previewDoc = {
    number: quote.number,
    issueDate: quote.issueDate,
    deadlineDate: quote.validUntil,
    deadlineLabel: quote.validUntil ? t("fields.validUntil") : undefined,
    serviceDate: quote.serviceDate,
    serviceDateEnd: quote.serviceDateEnd,
    notes: quote.notes,
    introText: quote.introText,
    vatRegulation: quote.vatRegulation,
    subtotal: quote.subtotal,
    taxAmount: quote.taxAmount,
    total: quote.total,
    contact: quote.contact,
    lineItems: quote.lineItems.map((li) => ({
      id: li.id, position: li.position,
      description: li.description, quantity: li.quantity, unit: li.unit,
      unitPrice: li.unitPrice, vatRate: li.vatRate, amount: li.amount,
    })),
  };

  return (
    <div className="flex overflow-hidden" style={{ height: "calc(100vh - 4.5rem)" }}>
      <InvoicePreviewPanel invoiceNumber={quote.number} pdfUrl={pdfUrl} backHref="/dashboard/quotes">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <BusinessDocPreview doc={previewDoc as any} docType="QUOTE" settings={settings} locale={locale} />
      </InvoicePreviewPanel>

      <div className="w-[400px] shrink-0 flex flex-col overflow-y-auto border-l border-border bg-background">
        <div className="sticky top-0 z-10 px-5 pt-5 pb-4 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-1">
              {prev ? (
                <Link href={`/dashboard/quotes/${prev.id}`} title={`Vorheriges: ${prev.number}`}
                  className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-muted transition-colors">
                  <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                </Link>
              ) : <span className="w-7 h-7" />}
              {next ? (
                <Link href={`/dashboard/quotes/${next.id}`} title={`Nächstes: ${next.number}`}
                  className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-muted transition-colors">
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </Link>
              ) : <span className="w-7 h-7" />}
            </div>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${statusClass}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
              {t(`status.${displayStatus}`)}
            </span>
          </div>

          <div className="flex items-center gap-2 mb-0.5">
            <h1 className="text-xl font-bold text-foreground tracking-tight">{quote.number}</h1>
            {converted && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-500">
                {t("convertedBadge")}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {fmtDate(quote.issueDate)}
            {quote.validUntil && (
              <> · {t("fields.validUntil")} {fmtDate(quote.validUntil, { day: "2-digit", month: "short", year: "numeric" })}</>
            )}
          </p>
        </div>

        <div className="flex-1 px-4 py-4 space-y-3">
          <Card>
            <Link href={`/dashboard/contacts/${quote.contactId}`} className="flex items-center gap-3 mb-4 group" title="Zum Kunden">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                <User className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate leading-tight group-hover:text-primary transition-colors">
                  {quote.contact.name}
                </p>
                {quote.contact.email && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{quote.contact.email}</p>
                )}
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </Link>

            <div className="pt-3 border-t border-border/60">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground shrink-0">{t("summary.total")}</span>
                <span className="text-2xl font-bold text-foreground tabular-nums tracking-tight text-right">
                  {formatCurrency(quote.total)}
                </span>
              </div>
              {Number(quote.taxAmount) > 0 && (
                <p className="text-xs text-muted-foreground mt-1 text-right">
                  inkl. <span className="tabular-nums">{formatCurrency(quote.taxAmount)}</span> MwSt.{" "}
                  · Netto <span className="tabular-nums">{formatCurrency(quote.subtotal)}</span>
                </p>
              )}
            </div>
          </Card>

          <Card title="Aktionen">
            <QuoteActions
              quoteId={quote.id}
              quoteNumber={quote.number}
              currentStatus={quote.status}
              converted={converted}
              clientEmail={quote.contact.email}
              vertical
            />
          </Card>

          <Card title={t("form.details")}>
            <Row label={t("fields.issueDate")}>{fmtDate(quote.issueDate)}</Row>
            {quote.validUntil && <Row label={t("fields.validUntil")}>{fmtDate(quote.validUntil)}</Row>}
            {quote.serviceDate && (
              <Row label={quote.serviceDateEnd ? t("fields.serviceDateEnd") : t("fields.serviceDate")}>
                {quote.serviceDateEnd
                  ? `${fmtDate(quote.serviceDate, { day: "2-digit", month: "2-digit", year: "numeric" })} – ${fmtDate(quote.serviceDateEnd, { day: "2-digit", month: "2-digit", year: "numeric" })}`
                  : fmtDate(quote.serviceDate)}
              </Row>
            )}
            {quote.contact.vatId && <Row label="USt-IdNr. Kunde">{quote.contact.vatId}</Row>}
            {converted && (
              <div className="pt-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" />
                  Weiterverarbeitet am {fmtDate(quote.convertedAt!, { day: "2-digit", month: "2-digit", year: "numeric" })}
                </span>
              </div>
            )}
          </Card>

          {hasFollowUps && (
            <Card title="Folgedokumente">
              <div className="space-y-2.5">
                {quote.orderConfirmations.map((oc) => (
                  <div key={oc.id} className="flex items-center gap-2.5 py-1.5">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <FileSignature className="w-3 h-3 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">{t("transactions.convertedToOC")}</p>
                      <Link href={`/dashboard/order-confirmations/${oc.id}`} className="text-xs font-semibold text-primary hover:underline">
                        {oc.number}
                      </Link>
                    </div>
                  </div>
                ))}
                {quote.invoices.map((inv) => (
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
              {quote.lineItems.map((item) => (
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
              <Row label={t("summary.subtotal")}>{formatCurrency(quote.subtotal)}</Row>
              {Object.entries(taxGroups).filter(([, v]) => v > 0.001).map(([rate, amount]) => (
                <Row key={rate} label={`MwSt. ${rate} %`}>{formatCurrency(amount)}</Row>
              ))}
              <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-border/60">
                <span className="text-xs font-bold text-foreground shrink-0">{t("summary.total")}</span>
                <span className="text-sm font-bold tabular-nums text-foreground">{formatCurrency(quote.total)}</span>
              </div>
            </div>
          </Card>

          {quote.notes && (
            <Card title={t("fields.notes")}>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{quote.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
