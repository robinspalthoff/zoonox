"use server";

import { db } from "@/lib/db";
import { auth, signOut } from "@/auth";
import { createAuditLog } from "@/lib/audit";
import bcrypt from "bcryptjs";

// Best Practice (Slack/Linear/Notion): Nach erfolgreichem Passwort-Wechsel
// wird der User abgemeldet und auf /auth/login geschickt. Vorteile:
//   - kein JWT-Cookie-Sync nötig (mustChangePassword im alten Token bleibt
//     irrelevant, weil der Cookie weg ist)
//   - User authentifiziert sich nochmal mit dem neuen Passwort → bewusste
//     Bestätigung, dass das neue Passwort wirklich funktioniert
//   - 2FA-Setup-Schritt läßt sich sauber zwischen Login und Dashboard
//     einhängen, ohne diese Logik anzufassen

export type ChangePasswordResult =
  | { success: false; error: string; field?: "password" | "confirmPassword" };

export async function changePassword(
  _prev: ChangePasswordResult | null,
  formData: FormData
): Promise<ChangePasswordResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated." };
  }

  const password = (formData.get("password") as string | null) ?? "";
  const confirmPassword = (formData.get("confirmPassword") as string | null) ?? "";

  if (!password) {
    return { success: false, error: "Password is required.", field: "password" };
  }
  if (password.length < 12) {
    return { success: false, error: "Password must be at least 12 characters.", field: "password" };
  }
  if (password !== confirmPassword) {
    return { success: false, error: "Passwords do not match.", field: "confirmPassword" };
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await db.user.update({
    where: { id: session.user.id },
    data: { password: hashedPassword, mustChangePassword: false },
  });

  await createAuditLog({
    action: "PASSWORD_CHANGED",
    tenantId: session.user.tenantId ?? null,
    userId: session.user.id,
    entityType: "User",
    entityId: session.user.id,
    details: { source: "force-change" },
  });

  // signOut wirft intern einen Redirect — diese Funktion kehrt nie regulär
  // zurück. Der Cookie wird gelöscht, der User landet auf /auth/login.
  await signOut({ redirectTo: "/auth/login?changed=1" });
  // unreachable
  throw new Error("unreachable");
}
