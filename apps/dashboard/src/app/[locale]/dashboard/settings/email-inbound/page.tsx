import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import {
  buildInboundAddress,
  getOrCreateMailbox,
  inboundDomain,
} from "@/lib/inbound/mailbox";
import { EmailInboundForm } from "./email-inbound-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.emailInbound");
  return { title: t("title") };
}

export default async function EmailInboundSettingsPage() {
  const { tenantId } = await requireTenant();
  const t = await getTranslations("settings.emailInbound");

  const configured = Boolean(inboundDomain());
  const mailbox = await getOrCreateMailbox(tenantId);

  const logs = await db.inboundMailLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      fromAddress: true,
      subject: true,
      status: true,
      rejectReason: true,
      documentIds: true,
      createdAt: true,
    },
  });

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
      </div>

      <EmailInboundForm
        configured={configured}
        aliasAddress={configured ? buildInboundAddress(mailbox.token) : null}
        active={mailbox.active}
        allowedSenders={mailbox.allowedSenders}
        logs={logs.map((l) => ({
          id: l.id,
          fromAddress: l.fromAddress,
          subject: l.subject,
          status: l.status,
          rejectReason: l.rejectReason,
          documentCount: l.documentIds.length,
          createdAt: l.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
