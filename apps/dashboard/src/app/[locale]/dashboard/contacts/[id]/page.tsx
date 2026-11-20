import type { Metadata } from "next";
import { requireTenant } from "@/lib/require-tenant";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Mail, Phone, Globe, Users, MapPin, CreditCard, FileText, Hash, Landmark, ReceiptText, Calendar, Percent } from "lucide-react";
import type { ContactRole } from "@prisma/client";
import { INVOICE_STATUS_CLASSES } from "@/lib/invoice-status";
import { ContactEditButton } from "./contact-edit-button";
import { formatCurrency } from "@/lib/format";

const ROLE_BADGE: Record<ContactRole, string> = {
  CUSTOMER: "bg-primary/10 text-primary",
  SUPPLIER: "bg-amber-500/10 text-amber-500",
  PARTNER: "bg-violet-500/10 text-violet-400",
  OTHER: "bg-slate-500/10 text-slate-400",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const contact = await db.contact.findUnique({ where: { id }, select: { name: true } });
  return { title: contact?.name ?? "Kontakt" };
}

function InfoRow({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href?: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0 p-6">
      <div className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
        {href ? (
          <a href={href} className="text-sm font-medium text-primary hover:underline" target="_blank" rel="noopener">
            {value}
          </a>
        ) : (
          <p className="text-sm font-medium text-foreground">{value}</p>
        )}
      </div>
    </div>
  );
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id, locale } = await params;
  const { tenantId, tenantRole } = await requireTenant();
  // Berater haben keinen Use Case für Kontakt-Details — Stammdaten-Pflege
  // ist Mandanten-Job. Redirect statt NoPermission, weil sonst Hilfslinks
  // (z. B. von einer Rechnung) im Nirgendwo enden.
  if (tenantRole === "ACCOUNTANT") {
    const { redirect } = await import("next/navigation");
    redirect(`/${locale}/dashboard`);
  }

  const t = await getTranslations("invoices");
  const tc = await getTranslations("contacts");

  const contact = await db.contact.findUnique({
    where: { id, tenantId },
    include: {
      invoices: {
        orderBy: { issueDate: "desc" },
        select: {
          id: true, number: true, status: true,
          issueDate: true, dueDate: true, total: true,
        },
      },
      documents: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fileName: true,
          documentNumber: true,
          documentType: true,
          recognizedDate: true,
          dueDate: true,
          status: true,
          lineItems: { select: { total: true } },
          payment: { select: { id: true } },
        },
      },
    },
  });
  if (!contact) notFound();

  // Eingangsrechnungen (Kreditor-Seite): Summen + offene Posten
  const isSupplier = contact.roles.includes("SUPPLIER");
  const incomingDocs = contact.documents.map((d) => {
    const total = d.lineItems.reduce(
      (s, li) => s + (li.total ? Number(li.total) : 0),
      0,
    );
    return {
      id: d.id,
      fileName: d.fileName,
      documentNumber: d.documentNumber,
      date: d.recognizedDate,
      dueDate: d.dueDate,
      status: d.status,
      total,
      isPaid: d.payment !== null,
    };
  });
  const incomingOpen = incomingDocs
    .filter((d) => !d.isPaid && d.status === "DONE")
    .reduce((s, d) => s + d.total, 0);
  const incomingTotal = incomingDocs
    .filter((d) => d.isPaid)
    .reduce((s, d) => s + d.total, 0);

  const totalRevenue = contact.invoices
    .filter(inv => inv.status === "PAID")
    .reduce((sum, inv) => sum + Number(inv.total), 0);

  const openAmount = contact.invoices
    .filter(inv => inv.status === "SENT" || inv.status === "OVERDUE")
    .reduce((sum, inv) => sum + Number(inv.total), 0);

  const addressParts = [contact.address, contact.zip && contact.city ? `${contact.zip} ${contact.city}` : contact.city].filter(Boolean);

  // Ansprechperson: Anrede (Code → Label) + Titel + Vor- + Nachname.
  const personName = [
    contact.contactSalutation ? tc(`salutations.${contact.contactSalutation}`) : null,
    contact.contactTitle,
    contact.contactFirstName,
    contact.contactLastName,
  ].filter(Boolean).join(" ");

  const hasPayment = contact.iban || contact.bic || contact.vatId || contact.taxId;

  return (
    <div className="space-y-6 p-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/contacts" className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl font-semibold text-foreground">{contact.name}</h1>
                {contact.roles.map((r) => (
                  <span key={r} className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${ROLE_BADGE[r]}`}>
                    {tc(`roles.${r}`)}
                  </span>
                ))}
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${contact.isActive ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                  {contact.isActive ? tc("status.active") : tc("status.inactive")}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {[
                  contact.customerNumber ? `${tc("fields.customerNumber")} ${contact.customerNumber}` : null,
                  contact.supplierNumber ? `${tc("fields.supplierNumber")} ${contact.supplierNumber}` : null,
                  personName || null,
                ].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
        </div>
        <ContactEditButton contact={{
          id: contact.id,
          name: contact.name,
          customerNumber: contact.customerNumber,
          supplierNumber: contact.supplierNumber,
          roles: contact.roles,
          contactSalutation: contact.contactSalutation,
          contactTitle: contact.contactTitle,
          contactFirstName: contact.contactFirstName,
          contactLastName: contact.contactLastName,
          contactPosition: contact.contactPosition,
          address: contact.address,
          city: contact.city,
          zip: contact.zip,
          country: contact.country,
          email: contact.email,
          phone: contact.phone,
          website: contact.website,
          iban: contact.iban,
          bic: contact.bic,
          vatId: contact.vatId,
          taxId: contact.taxId,
          notes: contact.notes,
          paymentTermDays: contact.paymentTermDays,
          discountDays: contact.discountDays,
          discountPercent: contact.discountPercent ? contact.discountPercent.toString() : null,
        }} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: contact details */}
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{tc("detail.contactSection")}</h2>
            {personName && (
              <InfoRow icon={<Users className="w-4 h-4" />} label={tc("detail.personLabel")} value={personName} />
            )}
            {contact.contactPosition && (
              <InfoRow icon={<Hash className="w-4 h-4" />} label={tc("fields.contactPosition")} value={contact.contactPosition} />
            )}
            {contact.email && (
              <InfoRow icon={<Mail className="w-4 h-4" />} label="E-Mail" value={contact.email} href={`mailto:${contact.email}`} />
            )}
            {contact.phone && (
              <InfoRow icon={<Phone className="w-4 h-4" />} label="Telefon" value={contact.phone} href={`tel:${contact.phone}`} />
            )}
            {contact.website && (
              <InfoRow icon={<Globe className="w-4 h-4" />} label="Website" value={contact.website} href={contact.website} />
            )}
            {addressParts.length > 0 && (
              <InfoRow icon={<MapPin className="w-4 h-4" />} label="Adresse" value={addressParts.join(", ")} />
            )}
            {contact.country && contact.country !== "DE" && (
              <InfoRow icon={<Globe className="w-4 h-4" />} label="Land" value={contact.country} />
            )}
          </div>

          {hasPayment && (
            <div className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{tc("sections.payment")}</h2>
              {contact.iban && (
                <InfoRow icon={<Landmark className="w-4 h-4" />} label="IBAN" value={contact.iban} />
              )}
              {contact.bic && (
                <InfoRow icon={<Landmark className="w-4 h-4" />} label="BIC" value={contact.bic} />
              )}
              {contact.vatId && (
                <InfoRow icon={<CreditCard className="w-4 h-4" />} label={tc("fields.vatId")} value={contact.vatId} />
              )}
              {contact.taxId && (
                <InfoRow icon={<CreditCard className="w-4 h-4" />} label={tc("fields.taxId")} value={contact.taxId} />
              )}
            </div>
          )}

          {(contact.paymentTermDays !== null || contact.discountDays !== null || contact.discountPercent !== null) && (
            <div className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {tc("sections.paymentTerms")}
              </h2>
              {contact.paymentTermDays !== null && (
                <InfoRow
                  icon={<Calendar className="w-4 h-4" />}
                  label={tc("fields.paymentTermDays")}
                  value={`${contact.paymentTermDays} ${tc("days")}`}
                />
              )}
              {contact.discountDays !== null && contact.discountPercent !== null && (
                <InfoRow
                  icon={<Percent className="w-4 h-4" />}
                  label={tc("fields.discount")}
                  value={`${contact.discountPercent.toString()} % / ${contact.discountDays} ${tc("days")}`}
                />
              )}
            </div>
          )}

          {contact.notes && (
            <div className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{tc("detail.notesSection")}</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{contact.notes}</p>
            </div>
          )}
        </div>

        {/* Right: stats + invoices */}
        <div className="lg:col-span-2 space-y-4">
          <div className={`grid gap-3 ${isSupplier ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
            {[
              { label: tc("detail.invoiceCount"), value: String(contact.invoices.length) },
              { label: tc("detail.revenuePaid"), value: formatCurrency(totalRevenue) },
              { label: tc("detail.openOverdue"), value: formatCurrency(openAmount) },
              ...(isSupplier
                ? [{ label: tc("detail.payablesOpen"), value: formatCurrency(incomingOpen) }]
                : []),
            ].map(stat => (
              <div key={stat.label} className="bg-card border border-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-1">{stat.label}</p>
                <p className="text-lg font-bold text-foreground tabular-nums">{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">{tc("detail.invoicesTitle")}</h2>
            </div>
            {contact.invoices.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">{tc("detail.noInvoices")}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">{tc("detail.invoiceNumber")}</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">{tc("detail.invoiceDate")}</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">{tc("detail.invoiceDue")}</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground text-xs">{tc("detail.invoiceAmount")}</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">{tc("detail.invoiceStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {contact.invoices.map(inv => (
                    <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/invoices/${inv.id}`} className="font-medium text-primary hover:underline">
                          {inv.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">
                        {new Date(inv.issueDate).toLocaleDateString("de-DE")}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">
                        {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("de-DE") : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                        {formatCurrency(inv.total)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${INVOICE_STATUS_CLASSES[inv.status]}`}>
                          {t(`status.${inv.status}`)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {isSupplier && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center gap-2">
                <ReceiptText className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">{tc("detail.incomingTitle")}</h2>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {tc("detail.incomingSummary", {
                    count: incomingDocs.length,
                    paid: formatCurrency(incomingTotal),
                  })}
                </span>
              </div>
              {incomingDocs.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">{tc("detail.noIncoming")}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">{tc("detail.docNumber")}</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">{tc("detail.invoiceDate")}</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">{tc("detail.invoiceDue")}</th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground text-xs">{tc("detail.invoiceAmount")}</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">{tc("detail.invoiceStatus")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomingDocs.map((d) => (
                      <tr key={d.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <Link href={`/dashboard/documents/${d.id}`} className="font-medium text-primary hover:underline">
                            {d.documentNumber ?? d.fileName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground tabular-nums">
                          {d.date ? new Date(d.date).toLocaleDateString("de-DE") : "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground tabular-nums">
                          {d.dueDate ? new Date(d.dueDate).toLocaleDateString("de-DE") : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                          {formatCurrency(d.total)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${d.isPaid ? "bg-success/10 text-success" : d.status === "DONE" ? "bg-amber-500/10 text-amber-500" : "bg-muted text-muted-foreground"}`}>
                            {tc(`detail.docStatus.${d.isPaid ? "PAID" : d.status}`)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
