import NextAuth from "next-auth";
import authConfig from "./auth.config";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const { auth } = NextAuth(authConfig);
const handleI18n = createMiddleware(routing);

// Routen die eine aktive Session erfordern
const PROTECTED = ["/dashboard"];
// Routen die nur ohne Session erreichbar sind (außer change-password — erfordert Session)
const AUTH_ROUTES = ["/auth/login", "/auth/signup"];
// Passwort-Änderung: erfordert Session, aber kein vollständiger Dashboard-Zugang
const CHANGE_PASSWORD_ROUTE = "/auth/change-password";

export default auth((req: NextRequest & { auth: unknown }) => {
  const { pathname } = req.nextUrl;
  const session = (req as unknown as { auth: { user: { mustChangePassword?: boolean } } | null }).auth;
  const isLoggedIn = !!session;

  // Locale aus URL extrahieren — nur valide Locales akzeptieren.
  const segmentLocale = pathname.split("/")[1];
  const locale = (routing.locales as readonly string[]).includes(segmentLocale)
    ? segmentLocale
    : routing.defaultLocale;

  const pathnameWithoutLocale = pathname.replace(/^\/(de|en)/, "") || "/";

  const isProtected = PROTECTED.some((r) => pathnameWithoutLocale.startsWith(r));
  const isAuthRoute = AUTH_ROUTES.some((r) => pathnameWithoutLocale.startsWith(r));
  const isChangePassword = pathnameWithoutLocale.startsWith(CHANGE_PASSWORD_ROUTE);

  // Nicht eingeloggt → Login
  if (isProtected && !isLoggedIn) {
    return NextResponse.redirect(new URL(`/${locale}/auth/login`, req.url));
  }

  // Eingeloggt + muss Passwort ändern → Change-Password erzwingen
  if (isLoggedIn && session?.user?.mustChangePassword && isProtected) {
    return NextResponse.redirect(new URL(`/${locale}/auth/change-password`, req.url));
  }

  // Eingeloggt + Passwort bereits geändert → nicht auf Change-Password bleiben
  if (isLoggedIn && !session?.user?.mustChangePassword && isChangePassword) {
    return NextResponse.redirect(new URL(`/${locale}/dashboard`, req.url));
  }

  // Eingeloggt → nicht auf Login/Setup bleiben
  if (isAuthRoute && isLoggedIn) {
    return NextResponse.redirect(new URL(`/${locale}/dashboard`, req.url));
  }

  return handleI18n(req);
});

export const config = {
  // `/m/...` ist die Mobile-Upload-Seite (Capability-Token, kein Login). Sie
  // läuft ohne Locale-Prefix und darf nicht in den Auth/i18n-Stack.
  matcher: ["/((?!_next|_vercel|api|m/|.*\\..*).*)" ],
};
