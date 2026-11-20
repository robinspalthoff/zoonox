"use server";

import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

export type PreLoginResult =
  | { ok: false }
  | { ok: true; twoFactorRequired: boolean };

/**
 * Prüft E-Mail + Passwort, BEVOR `signIn` aufgerufen wird, und meldet
 * zurück, ob für diesen Account ein zweiter Faktor nötig ist.
 *
 * Hintergrund: Der NextAuth-Credentials-`authorize` kann nur "Login ok"
 * oder "Login fehlgeschlagen" signalisieren — er kann dem Client nicht
 * mitteilen "Passwort stimmt, aber 2FA-Code fehlt". Daher dieser
 * Vorab-Check, damit das Formular den 2FA-Schritt gezielt einblenden
 * kann. Verifiziert wird der Code anschließend trotzdem serverseitig
 * in `authorize`.
 */
export async function preLogin(email: string, password: string): Promise<PreLoginResult> {
  const user = await db.user.findUnique({
    where: { email },
    select: { password: true, isActive: true, twoFactorEnabled: true },
  });

  if (!user?.password || !user.isActive) return { ok: false };

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return { ok: false };

  return { ok: true, twoFactorRequired: user.twoFactorEnabled };
}
