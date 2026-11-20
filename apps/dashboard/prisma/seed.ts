/**
 * Seed-Script — legt den ersten Admin-User an.
 *
 * Wird ausgeführt mit: npm run db:seed
 *
 * Benötigte Umgebungsvariablen (in .env.local):
 *   SEED_ADMIN_EMAIL    — E-Mail des ersten Admins
 *   SEED_ADMIN_PASSWORD — Passwort (wird gehasht gespeichert)
 *   SEED_ADMIN_FIRST_NAME — Vorname (optional, default: "Admin")
 *   SEED_ADMIN_LAST_NAME  — Nachname (optional)
 *
 * Nutzt `upsert` — kann gefahrlos mehrfach ausgeführt werden.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// .env.local manuell laden — tsx lädt diese Datei nicht automatisch
function loadEnvLocal() {
  try {
    const content = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      // Bestehende Env-Vars nicht überschreiben
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env.local nicht gefunden — ENV-Vars aus Umgebung nutzen
  }
}
loadEnvLocal();

const db = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const firstName = process.env.SEED_ADMIN_FIRST_NAME ?? "Admin";
  const lastName = process.env.SEED_ADMIN_LAST_NAME ?? null;

  if (!email || !password) {
    console.error(
      "\n❌ SEED_ADMIN_EMAIL und SEED_ADMIN_PASSWORD müssen in .env.local gesetzt sein.\n"
    );
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: "SUPER_ADMIN",
    },
  });

  console.log(`\n✓ Admin-User bereit: ${user.email} (${user.role})\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
