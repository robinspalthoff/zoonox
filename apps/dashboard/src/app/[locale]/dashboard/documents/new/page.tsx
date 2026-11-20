import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { NewDocumentView } from "./new-document-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documents.new");
  return { title: t("pageTitle") };
}

export default async function NewDocumentPage() {
  // Auth-Gate — sonst greift der Edge-Proxy ohnehin.
  await requireTenant();
  return <NewDocumentView />;
}
