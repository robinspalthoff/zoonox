import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AlertCircle } from "lucide-react";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import {
  InvoiceForm,
  type InvoiceTemplate,
  type RecurringConfig,
} from "../../invoice-form";
import { RecurringDetailActions } from "./recurring-actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("invoices.recurring");
  return { title: `${t("detailPageTitle")} · ${id.slice(0, 8)}` };
}

export default async function RecurringDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant();
  const t = await getTranslations("invoices.recurring");

  const [schedule, clients, settings] = await Promise.all([
    db.recurringInvoice.findFirst({
      where: { id, tenantId },
      include: {
        contact: { select: { id: true, name: true } },
        lineItems: { orderBy: { position: "asc" } },
        generatedInvoices: {
          orderBy: { issueDate: "desc" },
          take: 20,
          select: {
            id: true,
            number: true,
            status: true,
            issueDate: true,
            total: true,
          },
        },
      },
    }),
    db.contact.findMany({
      where: { tenantId, isActive: true, roles: { has: "CUSTOMER" } },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, email: true, customerNumber: true,
        contactFirstName: true, contactLastName: true, address: true, zip: true, city: true, country: true, vatId: true,
      },
    }),
    db.companySettings.findUnique({
      where: { tenantId },
      select: {
        name: true, nameSuffix: true, legalForm: true, address: true, zip: true, city: true, country: true,
        email: true, phone: true, website: true, vatId: true, taxId: true,
        bankName: true, iban: true, bic: true, logoBase64: true,
        defaultNotes: true, defaultIntroText: true,
        ownerName: true, managingDirector: true,
        taxMode: true,
      },
    }),
  ]);

  if (!schedule) notFound();

  const template: InvoiceTemplate = {
    contactId: schedule.contactId,
    introText: schedule.introText,
    notes: schedule.notes,
    vatRegulation: schedule.vatRegulation,
    buyerReference: schedule.buyerReference,
    leitwegId: schedule.leitwegId,
    lineItems: schedule.lineItems.map((li) => ({
      description: li.description,
      quantity: Number(li.quantity),
      unit: li.unit,
      unitPrice: Number(li.unitPrice),
      vatRate: li.vatRate,
    })),
  };

  const recurring: RecurringConfig = {
    id: schedule.id,
    title: schedule.title ?? "",
    firstIssueDate: schedule.firstIssueDate.toISOString().slice(0, 10),
    endDate: schedule.endDate?.toISOString().slice(0, 10) ?? "",
    interval: schedule.interval,
    autoGenerate: schedule.status === "ACTIVE",
    autoSend: schedule.autoSend,
    paymentTermDays: schedule.paymentTermDays,
    generatedCount: schedule.generatedCount,
    // Hand over the persisted nextRunAt + status so the form's live preview
    // can pick the right anchor (and skip rendering for COMPLETED series).
    nextRunAt: schedule.nextRunAt.toISOString(),
    status: schedule.status,
  };

  const isCompleted = schedule.status === "COMPLETED";

  // ── Header slot — rendered between sticky bar and form by InvoiceForm ──
  const headerSlot = (
    <div className="space-y-3">
      {/* Schedule-level actions toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-card border border-border rounded-xl px-5 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {t("history.scheduleLabel", {
              client: schedule.contact.name,
              count: schedule.generatedCount,
            })}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("history.scheduleHint")}</p>
        </div>
        <RecurringDetailActions
          id={schedule.id}
          status={schedule.status}
          autoGenerate={schedule.status === "ACTIVE"}
        />
      </div>

      {/* Next-dates preview now lives inside InvoiceForm and reacts live to
          interval / firstIssueDate / endDate / autoGenerate changes. */}

      {/* Error + completed banners stay close to the toolbar so they're
          visible without scrolling */}
      {schedule.lastError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 flex gap-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-destructive">{t("lastErrorTitle")}</p>
            <p className="text-foreground mt-1 break-words">{schedule.lastError}</p>
          </div>
        </div>
      )}

      {isCompleted && (
        <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {t("completedHint")}
        </div>
      )}
    </div>
  );

  return (
    <>
      <InvoiceForm
        clients={clients}
        settings={settings}
        template={template}
        recurring={recurring}
        headerSlot={headerSlot}
      />

      {/* History table below the form */}
      {schedule.generatedInvoices.length > 0 && (
        <div className="p-6">
          <div className="max-w-5xl mx-auto">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">{t("history.title")}</h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">{t("history.number")}</th>
                    <th className="px-4 py-2 font-medium">{t("history.issueDate")}</th>
                    <th className="px-4 py-2 font-medium">{t("history.status")}</th>
                    <th className="px-4 py-2 font-medium text-right">{t("history.total")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {schedule.generatedInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/dashboard/invoices/${inv.id}`}
                          className="text-foreground hover:text-primary font-medium transition-colors"
                        >
                          {inv.number}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {new Date(inv.issueDate).toLocaleDateString("de-DE")}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{inv.status}</td>
                      <td className="px-4 py-2.5 text-right text-foreground tabular-nums">
                        {new Intl.NumberFormat("de-DE", {
                          style: "currency",
                          currency: "EUR",
                        }).format(Number(inv.total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
