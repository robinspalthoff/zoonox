// Dev-only helper: legt einen zweiten Tenant an und macht den (per Email
// bezeichneten) User dort zum OWNER. Nur für lokales Testen des
// Tenant-Switchers — NICHT in Produktion ausführen.
//
// Usage:
//   npx tsx scripts/seed-test-tenant.ts <user-email> [tenant-name]
//   npx tsx scripts/seed-test-tenant.ts <user-email> --remove   # rückgängig
//
// Default-Tenant-Name: "Test Workspace"

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}

async function main() {
  const [email, ...rest] = process.argv.slice(2);
  if (!email) {
    console.error("Usage: tsx scripts/seed-test-tenant.ts <user-email> [tenant-name|--remove]");
    process.exit(1);
  }
  const remove = rest.includes("--remove");
  const tenantName = (!remove && rest[0]) || "Test Workspace";

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`User mit Email "${email}" nicht gefunden.`);
    process.exit(1);
  }

  if (remove) {
    const t = await db.tenant.findFirst({ where: { name: tenantName } });
    if (!t) {
      console.log(`Kein Tenant "${tenantName}" gefunden — nichts zu tun.`);
      return;
    }
    // Nur entfernen, wenn keine Geschäfts-Daten dranhängen.
    const counts = await db.$transaction([
      db.invoice.count({ where: { tenantId: t.id } }),
      db.contact.count({ where: { tenantId: t.id } }),
      db.document.count({ where: { tenantId: t.id } }),
      db.bankAccount.count({ where: { tenantId: t.id } }),
      db.journalEntry.count({ where: { tenantId: t.id } }),
    ]);
    if (counts.some((c) => c > 0)) {
      console.error(
        `Tenant "${tenantName}" enthält Geschäftsdaten (${counts.join(",")}) — Abbruch zur Sicherheit.`
      );
      process.exit(1);
    }
    await db.$transaction([
      db.tenantUser.deleteMany({ where: { tenantId: t.id } }),
      db.companySettings.deleteMany({ where: { tenantId: t.id } }),
      db.tenant.delete({ where: { id: t.id } }),
    ]);
    console.log(`Tenant "${tenantName}" entfernt.`);
    return;
  }

  // Eindeutigen Slug bilden
  const baseSlug = slugify(tenantName);
  let slug = baseSlug;
  for (let i = 1; await db.tenant.findUnique({ where: { slug } }); i++) {
    slug = `${baseSlug}-${i}`;
  }

  const tenant = await db.tenant.create({
    data: {
      slug,
      name: tenantName,
      members: { create: { userId: user.id, role: "OWNER", isDefault: false } },
      companySettings: { create: {} },
    },
    select: { id: true, slug: true, name: true },
  });

  console.log("Test-Tenant angelegt:");
  console.log(JSON.stringify(tenant, null, 2));
  console.log(
    `\nLog dich neu ein (oder warte auf JWT-Refresh) und der Switcher sollte beide Workspaces zeigen.`
  );
  console.log(`Aufräumen: npx tsx scripts/seed-test-tenant.ts ${email} --remove`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
