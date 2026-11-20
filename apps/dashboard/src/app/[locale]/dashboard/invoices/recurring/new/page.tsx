import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { InvoiceForm, type RecurringConfig } from "../../invoice-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices.recurring");
  return { title: t("newPageTitle") };
}

export default async function NewRecurringPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { tenantId, tenantRole } = await requireTenant();
  const { locale } = await params;
  if (tenantRole === "ACCOUNTANT") redirect(`/${locale}/dashboard/invoices/recurring`);
  const t = await getTranslations("invoices.recurring");

  // Same shape the InvoiceForm expects — keep both queries identical to
  // invoices/new so the form sees the same client + settings data.
  const [clients, settings] = await Promise.all([
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

  if (clients.length === 0) {
    return (
      <div className="p-6">
        <div className="max-w-4xl mx-auto">
          <Link
            href="/dashboard/invoices/recurring"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t("backToList")}
          </Link>
          <h1 className="text-2xl font-semibold text-foreground">{t("newTitle")}</h1>
        </div>
        <div className="bg-card border border-border rounded-xl p-8 text-center max-w-4xl mx-auto mt-6">
          <p className="text-sm text-muted-foreground">{t("noClients")}</p>
          <Link
            href="/dashboard/contacts"
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {t("createClientCta")}
          </Link>
        </div>
      </div>
    );
  }

  // Empty recurring config so InvoiceForm starts in recurring mode with sensible defaults.
  const recurring: RecurringConfig = {
    title: "",
    firstIssueDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    interval: "MONTHLY",
    autoGenerate: true,
    autoSend: false,
    paymentTermDays: 14,
  };

  return <InvoiceForm clients={clients} settings={settings} recurring={recurring} />;
}
