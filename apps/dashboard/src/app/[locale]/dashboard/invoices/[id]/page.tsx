import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import {
  Lock, FileX2, CornerUpLeft, Hash, User, ExternalLink,
  ChevronLeft, ChevronRight, Send, CircleCheckBig, Ban,
  FileCode2, CheckCircle2, Repeat, FilePenLine, ClipboardList, FileSignature,
} from "lucide-react";
import { InvoiceActions } from "./invoice-actions";
import { PaymentQrToggle } from "./payment-qr-toggle";
import { ReadyToSendBanner } from "./ready-to-send-banner";
import { InvoiceDocumentPreview } from "./invoice-document-preview";
import { InvoicePreviewPanel } from "./invoice-preview-panel";
import { listComments } from "@/lib/comments/queries";
import { can } from "@/lib/permissions";
import { CommentSection } from "@/components/comments/comment-section";
import { getMonthCloseStatus } from "@/lib/month-close/queries";
import { MonthCloseBanner } from "@/components/month-close/month-close-banner";
import { monthLabelFromDate } from "@/components/month-close/month-label";
import { INVOICE_STATUS_CLASSES, INVOICE_STATUS_DOT } from "@/lib/invoice-status";
import { formatCurrency } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const invoice = await db.invoice.findUnique({ where: { id }, select: { number: true } });
  return { title: invoice?.number ?? "Rechnung" };
}

function fmtDate(d: Date | string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(d).toLocaleDateString("de-DE", opts ?? { day: "2-digit", month: "long", year: "numeric" });
}

function fmtDateTime(d: Date | string) {
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Shared card shell ──────────────────────────────────────────────────────────
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

// ── Simple label–value row inside a card ──────────────────────────────────────
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-foreground text-right">{children}</span>
    </div>
  );
}

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ send?: string; pay?: string; cn?: string }>;
}) {
  const { id, locale } = await params;
  const { send, pay, cn } = await searchParams;
  const autoOpenSend = send === "1";
  const autoOpenPay = pay === "1";
  const autoOpenCreditNote = cn === "1";
  const tenant = await requireTenant();
  const { tenantId, tenantRole, userId } = tenant;

  const t = await getTranslations("invoices");

  const [invoice, settings] = await Promise.all([
    db.invoice.findUnique({
      where: { id, tenantId },
      include: {
        contact: true,
        lineItems: { orderBy: { position: "asc" } },
        creditNoteFor: { select: { id: true, number: true, issueDate: true } },
        // All linked adjustment docs (Gutschriften AND Rechnungskorrekturen).
        // Filtered into the two buckets below — corrections can be multiple.
        creditNotes:   { select: { id: true, number: true, type: true, issueDate: true }, orderBy: { createdAt: "asc" } },
        recurringInvoice: { select: { id: true, title: true, interval: true } },
        quote:             { select: { id: true, number: true } },
        orderConfirmation: { select: { id: true, number: true } },
      },
    }),
    db.companySettings.findUnique({ where: { tenantId } }),
  ]);
  if (!invoice) notFound();

  const invoiceComments = await listComments(tenantId, "INVOICE", invoice.id);
  const invoiceMonthInfo = monthLabelFromDate(invoice.issueDate, locale);
  const invoiceMonthStatus = await getMonthCloseStatus(tenantId, invoice.issueDate);

  // ── Prev / Next invoice by creation order ────────────────────────────────────
  const [prevInvoice, nextInvoice] = await Promise.all([
    db.invoice.findFirst({
      where: { tenantId, createdAt: { lt: invoice.createdAt } },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true },
    }),
    db.invoice.findFirst({
      where: { tenantId, createdAt: { gt: invoice.createdAt } },
      orderBy: { createdAt: "asc" },
      select: { id: true, number: true },
    }),
  ]);

  const taxGroups: Record<number, number> = {};
  for (const item of invoice.lineItems) {
    const tax = Number(item.amount) * (item.vatRate / 100);
    taxGroups[item.vatRate] = (taxGroups[item.vatRate] ?? 0) + tax;
  }

  const isFrozen    = invoice.status !== "DRAFT";
  const isCreditNote = invoice.type === "CREDIT_NOTE";
  const isCorrection = invoice.type === "CORRECTION";
  // Split the adjustment-doc children: at most one Gutschrift, possibly many
  // Rechnungskorrekturen.
  const creditNote  = invoice.creditNotes.find((c) => c.type === "CREDIT_NOTE") ?? null;
  const corrections = invoice.creditNotes.filter((c) => c.type === "CORRECTION");
  const statusClass = INVOICE_STATUS_CLASSES[invoice.status] ?? INVOICE_STATUS_CLASSES.DRAFT;
  const statusDot   = INVOICE_STATUS_DOT[invoice.status]     ?? INVOICE_STATUS_DOT.DRAFT;
  // Locale travels as a query param — the PDF API route lives outside the
  // [locale] segment, so it has no other way to know the UI language.
  const pdfUrl      = `/api/invoices/${invoice.id}/pdf?locale=${locale}`;

  // An invoice is an E-Rechnung if buyerReference was set during creation
  const isEInvoice = !!invoice.buyerReference?.trim();

  // Determine which transaction events exist
  const hasTransactions =
    invoice.finalizedAt ||
    invoice.paidAt ||
    creditNote ||
    invoice.creditNoteFor ||
    corrections.length > 0 ||
    invoice.quote ||
    invoice.orderConfirmation;

  return (
    <div className="flex overflow-hidden" style={{ height: "calc(100vh - 4.5rem)" }}>

      {/* ── Left: Zoomable Preview Panel ──────────────────────────────────── */}
      <InvoicePreviewPanel invoiceNumber={invoice.number} pdfUrl={pdfUrl}>
        <InvoiceDocumentPreview invoice={invoice} settings={settings} locale={locale} />
      </InvoicePreviewPanel>

      {/* ── Right: Detail Sidebar ─────────────────────────────────────────── */}
      <div className="w-[400px] shrink-0 flex flex-col overflow-y-auto border-l border-border bg-background">

        {/* ── Sticky header: number, status, prev/next ────────────────────── */}
        <div className="sticky top-0 z-10 px-5 pt-5 pb-4 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2 mb-2">

            {/* Prev / Next navigation */}
            <div className="flex items-center gap-1">
              {prevInvoice ? (
                <Link
                  href={`/dashboard/invoices/${prevInvoice.id}`}
                  className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-muted transition-colors"
                  title={`Vorherige: ${prevInvoice.number}`}
                >
                  <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                </Link>
              ) : (
                <span className="w-7 h-7" />
              )}
              {nextInvoice ? (
                <Link
                  href={`/dashboard/invoices/${nextInvoice.id}`}
                  className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-muted transition-colors"
                  title={`Nächste: ${nextInvoice.number}`}
                >
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </Link>
              ) : (
                <span className="w-7 h-7" />
              )}
            </div>

            {/* Status badge */}
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${statusClass}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
              {t(`status.${invoice.status}`)}
              {isFrozen && <Lock className="w-3 h-3 ml-0.5 opacity-50" />}
            </span>
          </div>

          <div className="flex items-center gap-2 mb-0.5">
            <h1 className="text-xl font-bold text-foreground tracking-tight">{invoice.number}</h1>
            {isCreditNote && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-amber-500/10 text-amber-500">
                {t("badges.creditNote")}
              </span>
            )}
            {isCorrection && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-500/10 text-blue-500">
                {t("badges.correction")}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {fmtDate(invoice.issueDate)}
            {invoice.dueDate && (
              <> · Fällig {fmtDate(invoice.dueDate, { day: "2-digit", month: "short", year: "numeric" })}</>
            )}
          </p>
        </div>

        {/* ── Scrollable card area ──────────────────────────────────────────── */}
        <div className="flex-1 px-4 py-4 space-y-3">

          {/* ── "Ready to send" banner — only on the first arrival from the
                "Überprüfen & Versenden" CTA, and only while the invoice is
                still a DRAFT. Disappears once status flips to SENT.  ─────── */}
          {autoOpenSend && invoice.status === "DRAFT" && (
            <ReadyToSendBanner invoiceId={invoice.id} />
          )}

          {/* ── Card: Client + Amount ───────────────────────────────────────── */}
          <Card>
            <Link
              href={`/dashboard/clients/${invoice.contactId}`}
              className="flex items-center gap-3 mb-4 group"
              title="Zum Kunden"
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                <User className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate leading-tight group-hover:text-primary transition-colors">
                  {invoice.contact.name}
                </p>
                {invoice.contact.email && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{invoice.contact.email}</p>
                )}
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </Link>

            <div className="pt-3 border-t border-border/60">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground shrink-0">{t("summary.total")}</span>
                <span className="text-2xl font-bold text-foreground tabular-nums tracking-tight text-right">
                  {formatCurrency(invoice.total)}
                </span>
              </div>
              {Number(invoice.taxAmount) > 0 && (
                <p className="text-xs text-muted-foreground mt-1 text-right">
                  inkl. <span className="tabular-nums">{formatCurrency(invoice.taxAmount)}</span> MwSt.
                  {" "}· Netto <span className="tabular-nums">{formatCurrency(invoice.subtotal)}</span>
                </p>
              )}
            </div>
          </Card>

          {/* ── Card: Actions ───────────────────────────────────────────────── */}
          <Card title="Aktionen">
            <InvoiceActions
              invoiceId={invoice.id}
              invoiceNumber={invoice.number}
              invoiceTotal={Number(invoice.total)}
              currentStatus={invoice.status}
              clientEmail={invoice.contact.email ?? null}
              isCreditNote={isCreditNote}
              isCorrection={isCorrection}
              autoOpenSend={autoOpenSend}
              autoOpenPay={autoOpenPay}
              autoOpenCreditNote={autoOpenCreditNote}
              vertical
            />
          </Card>

          {/* ── Card: Invoice Details ───────────────────────────────────────── */}
          <Card title={isCreditNote ? t("form.creditNoteDetails") : t("form.invoiceDetails")}>
            <Row label={t("fields.issueDate")}>{fmtDate(invoice.issueDate)}</Row>
            {invoice.dueDate && (
              <Row label={t("fields.dueDate")}>{fmtDate(invoice.dueDate)}</Row>
            )}
            {invoice.serviceDate && (
              <Row label={invoice.serviceDateEnd ? t("serviceDateEnd") : t("serviceDate")}>
                {invoice.serviceDateEnd
                  ? `${fmtDate(invoice.serviceDate, { day: "2-digit", month: "2-digit", year: "numeric" })} – ${fmtDate(invoice.serviceDateEnd, { day: "2-digit", month: "2-digit", year: "numeric" })}`
                  : fmtDate(invoice.serviceDate)}
              </Row>
            )}
            {invoice.contact.vatId && (
              <Row label="USt-IdNr. Kunde">{invoice.contact.vatId}</Row>
            )}
            {invoice.buyerReference && (
              <Row label="Kundenreferenz">{invoice.buyerReference}</Row>
            )}
            {/* EPC payment QR-Code toggle — not applicable to credit notes
                (a Gutschrift is never paid by the recipient). Editable only
                while the invoice is a DRAFT. */}
            {!isCreditNote && (
              <PaymentQrToggle
                invoiceId={invoice.id}
                enabled={invoice.paymentQrEnabled}
                editable={!isFrozen}
              />
            )}
            {isEInvoice && (
              <div className="pt-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" />
                  E-Rechnung
                </span>
              </div>
            )}
          </Card>

          {/* ── Card: Transactions (timeline of events) ─────────────────────── */}
          {hasTransactions && (
            <Card title="Transaktionen">
              <div className="space-y-2.5">

                {/* Aus Angebot — pre-sale link */}
                {invoice.quote && (
                  <div className="flex items-center gap-2.5 py-1.5">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <ClipboardList className="w-3 h-3 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">Aus Angebot</p>
                      <Link href={`/dashboard/quotes/${invoice.quote.id}`} className="text-xs font-semibold text-primary hover:underline">
                        {invoice.quote.number}
                      </Link>
                    </div>
                  </div>
                )}

                {/* Aus Auftragsbestätigung */}
                {invoice.orderConfirmation && (
                  <div className="flex items-center gap-2.5 py-1.5">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <FileSignature className="w-3 h-3 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">Aus Auftragsbestätigung</p>
                      <Link href={`/dashboard/order-confirmations/${invoice.orderConfirmation.id}`} className="text-xs font-semibold text-primary hover:underline">
                        {invoice.orderConfirmation.number}
                      </Link>
                    </div>
                  </div>
                )}

                {/* Aus wiederkehrender Serie (this invoice was auto-generated) */}
                {invoice.recurringInvoice && (
                  <div className="flex items-center gap-2.5 py-1.5">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Repeat className="w-3 h-3 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">Aus wiederkehrender Serie</p>
                      <Link
                        href={`/dashboard/invoices/recurring/${invoice.recurringInvoice.id}`}
                        className="text-xs font-semibold text-primary hover:underline truncate inline-block max-w-full"
                      >
                        {invoice.recurringInvoice.title ?? "Vorlage"}
                      </Link>
                    </div>
                  </div>
                )}

                {/* Gutschrift / Korrektur zu (this invoice references another) */}
                {invoice.creditNoteFor && (
                  <div className="flex items-center gap-2.5 py-1.5">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                        isCorrection ? "bg-blue-500/10" : "bg-amber-500/10"
                      }`}
                    >
                      {isCorrection ? (
                        <FilePenLine className="w-3 h-3 text-blue-500" />
                      ) : (
                        <CornerUpLeft className="w-3 h-3 text-amber-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">
                        {isCorrection ? t("transactions.correctionFor") : t("transactions.creditNoteFor")}
                      </p>
                      <Link
                        href={`/dashboard/invoices/${invoice.creditNoteFor.id}`}
                        className={`text-xs font-semibold hover:underline ${
                          isCorrection ? "text-blue-500" : "text-amber-500"
                        }`}
                      >
                        {invoice.creditNoteFor.number}
                      </Link>
                    </div>
                  </div>
                )}

                {/* Storniert durch (a credit note exists for this invoice) */}
                {creditNote && (
                  <div className="flex items-center gap-2.5 py-1.5">
                    <div className="w-6 h-6 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                      <FileX2 className="w-3 h-3 text-destructive" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">{t("transactions.cancelledBy")}</p>
                      <Link
                        href={`/dashboard/invoices/${creditNote.id}`}
                        className="text-xs font-semibold text-destructive hover:underline"
                      >
                        {creditNote.number}
                      </Link>
                    </div>
                  </div>
                )}

                {/* Korrigiert durch — one entry per correction (multiple allowed) */}
                {corrections.map((c) => (
                  <div key={c.id} className="flex items-center gap-2.5 py-1.5">
                    <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                      <FilePenLine className="w-3 h-3 text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">{t("transactions.correctedBy")}</p>
                      <Link
                        href={`/dashboard/invoices/${c.id}`}
                        className="text-xs font-semibold text-blue-500 hover:underline"
                      >
                        {c.number}
                      </Link>
                    </div>
                  </div>
                ))}

                {/* Festgeschrieben / Versendet */}
                {invoice.finalizedAt && (
                  <div className="flex items-center gap-2.5 py-1.5">
                    <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                      <Send className="w-3 h-3 text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">Festgeschrieben</p>
                      <p className="text-xs font-semibold text-foreground">{fmtDateTime(invoice.finalizedAt)} Uhr</p>
                    </div>
                    <Lock className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                  </div>
                )}

                {/* Bezahlt am */}
                {invoice.paidAt && (
                  <div className="flex items-center gap-2.5 py-1.5">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <CircleCheckBig className="w-3 h-3 text-emerald-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">Bezahlt am</p>
                      <p className="text-xs font-semibold text-foreground">{fmtDate(invoice.paidAt)}</p>
                    </div>
                  </div>
                )}

                {/* Cancelled (no credit note) */}
                {invoice.status === "CANCELLED" && !creditNote && (
                  <div className="flex items-center gap-2.5 py-1.5">
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <Ban className="w-3 h-3 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-muted-foreground">Storniert</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── Card: Line Items ─────────────────────────────────────────────── */}
          <Card title={t("lineItems.title")}>
            <div className="space-y-3">
              {invoice.lineItems.map((item) => (
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
              <Row label={t("summary.subtotal")}>{formatCurrency(invoice.subtotal)}</Row>
              {Object.entries(taxGroups).filter(([, v]) => v > 0.001).map(([rate, amount]) => (
                <Row key={rate} label={`MwSt. ${rate} %`}>{formatCurrency(amount)}</Row>
              ))}
              <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-border/60">
                <span className="text-xs font-bold text-foreground shrink-0">{t("summary.total")}</span>
                <span className="text-sm font-bold tabular-nums text-foreground">{formatCurrency(invoice.total)}</span>
              </div>
            </div>
          </Card>

          {/* ── Card: Notes ──────────────────────────────────────────────────── */}
          {invoice.notes && (
            <Card title={t("fields.notes")}>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{invoice.notes}</p>
            </Card>
          )}

          {/* ── GoBD: SHA-256 hash ───────────────────────────────────────────── */}
          {invoice.pdfHash && (
            <Card>
              <div className="flex items-center gap-1.5 mb-2">
                <Hash className="w-3 h-3 text-muted-foreground" />
                <p className="text-xs text-muted-foreground font-medium">SHA-256 Prüfsumme</p>
              </div>
              <code className="block text-xs font-mono text-muted-foreground/80 break-all leading-relaxed">
                {invoice.pdfHash}
              </code>
            </Card>
          )}

          {/* ── Monatsabschluss-Hinweis (Soft-Lock) ────────────────────────── */}
          <MonthCloseBanner
            status={invoiceMonthStatus}
            monthLabel={invoiceMonthInfo.monthLabel}
            year={invoiceMonthInfo.year}
          />

          {/* ── Kommentare (Steuerberater-Workflow) ────────────────────────── */}
          <CommentSection
            entityType="INVOICE"
            entityId={invoice.id}
            comments={invoiceComments}
            currentUserId={userId}
            canWrite={can(tenantRole, "comments.write")}
            canResolve={can(tenantRole, "comments.resolve")}
          />

        </div>
      </div>
    </div>
  );
}
