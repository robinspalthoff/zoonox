import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { ContactsView } from "./contacts-view";
import { NoPermissionCard } from "@/components/no-permission-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contacts");
  return { title: t("pageTitle") };
}

export default async function ContactsPage() {
  const session = await requireTenant();
  const t = await getTranslations("contacts");

  // Kontakte sind ausschließlich Mandanten-Stammdaten. Berater sehen in
  // der Sidebar gar keinen Kontakte-Eintrag — diese Page ist nur per
  // Direkt-URL erreichbar (z. B. geteilter Link). Wir blocken sie hier
  // sauber mit dem Standard-NoPermission-Pattern statt eine leere oder
  // verwirrende Read-Sicht zu zeigen.
  if (session.tenantRole === "ACCOUNTANT") {
    return (
      <NoPermissionCard title={t("title")} description={t("noPermissionAccountant")} />
    );
  }

  const contacts = await db.contact.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { name: "asc" },
    include: { _count: { select: { invoices: true } } },
  });

  return <ContactsView contacts={JSON.parse(JSON.stringify(contacts))} />;
}
