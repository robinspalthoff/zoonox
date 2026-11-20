"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import {
  LayoutDashboard,
  FileText,
  Users,
  ScrollText,
  Settings,
  Landmark,
  ChevronLeft,
  ChevronRight,
  ReceiptText,
  Contact,
  Calculator,
  Repeat,
  Boxes,
  Wallet,
  ClipboardList,
  FileSignature,
  Briefcase,
  BarChart3,
  FileSpreadsheet,
  CheckSquare,
  Building,
  UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { appConfig } from "@/config/app";
import type { Role, TenantRole } from "@prisma/client";
import { can } from "@/lib/permissions";

import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  role: Role;
  tenantRole: TenantRole;
  tenantCount: number;
}

export function Sidebar({ collapsed, onToggle, role, tenantRole, tenantCount }: SidebarProps) {
  const t = useTranslations("common.nav");
  const pathname = usePathname();

  // ─── Collapsed flyout state ──────────────────────────────────────────
  // When the sidebar is collapsed we lose access to nested sub-pages
  // (Bank → Übersicht/Konten/Kassenbuch). Hovering a parent icon opens
  // a small popover to the right with its children. State holds the
  // currently-flyout'd item plus its viewport-top so we can position
  // the popover with `position: fixed` (escapes the nav's overflow-x
  // clipping without needing a portal).
  const [flyout, setFlyout] = useState<{ href: string; top: number } | null>(null);
  // Small grace timer when leaving the trigger lets the user move the
  // mouse onto the popover without it snapping shut mid-gap.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function openFlyout(href: string, top: number) {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setFlyout({ href, top });
  }
  function scheduleClose() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setFlyout(null), 120);
  }
  function cancelClose() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }

  const isAdminOrAbove = role === "SUPER_ADMIN" || role === "ADMIN";
  const isAccountant = tenantRole === "ACCOUNTANT";

  type NavItem = {
    href: "/dashboard" | "/dashboard/invoices" | "/dashboard/orders" | "/dashboard/documents" | "/dashboard/bank" | "/dashboard/contacts" | "/dashboard/reports" | "/dashboard/team" | "/dashboard/audit-log" | "/dashboard/settings" | "/dashboard/firm" | "/dashboard/firm/clients" | "/dashboard/firm/closing" | "/dashboard/tax-advisor";
    label: string;
    icon: typeof LayoutDashboard;
    exact?: boolean;
    /**
     * Zusätzliche Pfad-Präfixe, die diesen Eintrag als aktiv markieren —
     * ohne dass das Ziel des Links sich ändert. Beispiel: „Steuerberater"
     * highlightet auch auf /dashboard/firm/closing, weil der Mandant von
     * dort aus den Monatsabschluss bearbeitet (die Page hat aber keinen
     * eigenen Sidebar-Eintrag).
     */
    activePaths?: string[];
    /** Marks this item as a contextual-onboarding anchor target. */
    onboardingId?: string;
    /**
     * Overrides the navigation target of the parent link without
     * affecting active-state detection or the children matching, which
     * both stay keyed off `href`. Lets "Einstellungen" land directly on
     * the company tab while the section still highlights everywhere.
     */
    linkHref?: "/dashboard/settings/company" | "/dashboard/quotes" | "/dashboard/taxes" | "/dashboard/firm/clients" | "/dashboard/firm/closing";
    children?: {
      href:
        | "/dashboard/invoices"
        | "/dashboard/invoices/recurring"
        | "/dashboard/quotes"
        | "/dashboard/order-confirmations"
        | "/dashboard/documents"
        | "/dashboard/documents/assets"
        | "/dashboard/bank"
        | "/dashboard/bank/accounts"
        | "/dashboard/bank/cashbook"
        | "/dashboard/taxes"
        | "/dashboard/reports/open-items"
        | "/dashboard/reports/bwa"
        | "/dashboard/firm/clients"
        | "/dashboard/firm/closing"
        | "/dashboard/settings"
        | "/dashboard/settings/company"
        | "/dashboard/settings/accounting"
        | "/dashboard/settings/number-ranges"
        | "/dashboard/settings/email-inbound"
        | "/dashboard/settings/appearance";
      label: string;
      icon: typeof LayoutDashboard;
    }[];
  };

  // Sichtbarkeits-Gates pro Bereich. ACCOUNTANT sieht die Belegseite, Bank,
  // Reports, Audit-Log und seinen eigenen Kanzlei-Bereich, aber keine
  // Rechnungsstellung, keine Stammdaten-Verwaltung und keine Settings.
  const canSeeInvoicing       = can(tenantRole, "invoices.read");
  // Aufträge (Angebote + Auftragsbestätigungen) sind für Steuerberater
  // operativ nicht relevant — Direkt-URL bleibt erreichbar (Permissions
  // sind weiterhin gesetzt), nur die Sidebar-Navigation wird reduziert.
  const canSeeQuotes          = can(tenantRole, "quotes.read") && !isAccountant;
  const canSeeDocuments       = can(tenantRole, "documents.read");
  const canSeeBank            = can(tenantRole, "bank.read");
  // Kontakte pflegt der Mandant — Berater hat keinen Use Case dafür.
  const canSeeContacts        = can(tenantRole, "contacts.read") && !isAccountant;
  const canSeeReports         = can(tenantRole, "reports.read");
  // Audit-Log ist für Berater diagnostisch (Compliance-Nachweis), nicht
  // operativ — aus der Sidebar raus, Direkt-URL bleibt erreichbar.
  const canSeeAuditLog        = can(tenantRole, "auditLog.read") && !isAccountant;
  const canSeeSettings        = can(tenantRole, "settings.read");
  const canSeeTeam            = can(tenantRole, "team.read");
  const canSeeFirmOverview    = can(tenantRole, "firmOverview.view");
  // "Kanzlei"-Sektion ist konzeptionell die Steuerberater-Sicht: Mandanten-
  // Übersicht + Monatsabschlüsse aller Mandanten. Für Owner/Member ergibt
  // dieser Bereich keinen Sinn — sie sehen Monatsabschluss stattdessen in
  // ihrer eigenen Steuerberater-Karte unter /dashboard/tax-advisor.
  const showClientsList       = isAccountant && tenantCount > 1;
  const showClosing           = isAccountant;
  const showFirmSection       = isAccountant;

  const navItems: NavItem[] = [
    { href: "/dashboard" as const, label: t("overview"), icon: LayoutDashboard, exact: true },
    ...(showFirmSection
      ? ([{
          href: "/dashboard/firm" as const,
          label: t("firm"),
          icon: Building,
          // Parent landet auf der ersten verfügbaren Sub-Seite:
          // Mandanten wenn vorhanden, sonst direkt zur Closing-Liste.
          linkHref: showClientsList
            ? ("/dashboard/firm/clients" as const)
            : ("/dashboard/firm/closing" as const),
          children: [
            ...(showClientsList
              ? [{ href: "/dashboard/firm/clients" as const, label: t("firmClients"), icon: Building }]
              : []),
            ...(showClosing
              ? [{ href: "/dashboard/firm/closing" as const, label: t("firmClosing"), icon: CheckSquare }]
              : []),
          ],
        }] satisfies NavItem[])
      : []),
    ...(canSeeInvoicing
      ? ([{
          href: "/dashboard/invoices" as const,
          label: t("invoices"),
          icon: FileText,
          onboardingId: "nav-invoices",
          children: [
            { href: "/dashboard/invoices" as const, label: t("invoicesAll"), icon: FileText },
            { href: "/dashboard/invoices/recurring" as const, label: t("invoicesRecurring"), icon: Repeat },
          ],
        }] satisfies NavItem[])
      : []),
    ...(canSeeQuotes
      ? ([{
          href: "/dashboard/orders" as const,
          label: t("orders"),
          icon: Briefcase,
          linkHref: "/dashboard/quotes" as const,
          children: [
            { href: "/dashboard/quotes" as const, label: t("quotes"), icon: ClipboardList },
            { href: "/dashboard/order-confirmations" as const, label: t("orderConfirmations"), icon: FileSignature },
          ],
        }] satisfies NavItem[])
      : []),
    ...(canSeeDocuments
      ? ([{
          href: "/dashboard/documents" as const,
          label: t("documents"),
          icon: ReceiptText,
          children: [
            { href: "/dashboard/documents" as const, label: t("documentsAll"), icon: ReceiptText },
            { href: "/dashboard/documents/assets" as const, label: t("documentsAssets"), icon: Boxes },
          ],
        }] satisfies NavItem[])
      : []),
    ...(canSeeBank
      ? ([{
          href: "/dashboard/bank" as const,
          label: t("bank"),
          icon: Landmark,
          children: [
            { href: "/dashboard/bank" as const, label: t("bankOverview"), icon: LayoutDashboard },
            { href: "/dashboard/bank/accounts" as const, label: t("bankAccounts"), icon: Landmark },
            { href: "/dashboard/bank/cashbook" as const, label: t("bankCashbook"), icon: Wallet },
          ],
        }] satisfies NavItem[])
      : []),
    ...(canSeeContacts
      ? ([{ href: "/dashboard/contacts" as const, label: t("contacts"), icon: Contact }] satisfies NavItem[])
      : []),
    ...(canSeeReports
      ? ([{
          href: "/dashboard/reports" as const,
          label: t("reports"),
          icon: BarChart3,
          linkHref: "/dashboard/taxes" as const,
          children: [
            { href: "/dashboard/taxes" as const, label: t("reportsTaxes"), icon: Calculator },
            { href: "/dashboard/reports/open-items" as const, label: t("reportsOpenItems"), icon: FileSpreadsheet },
            { href: "/dashboard/reports/bwa" as const, label: t("reportsBwa"), icon: BarChart3 },
          ],
        }] satisfies NavItem[])
      : []),
    // "Steuerberater" als eigene Top-Level-Sektion — DATEV-Export,
    // Berater-Einladung, Monatsabschluss. Berater selbst sehen es nicht
    // (er IST der Steuerberater, seine Arbeit findet im Dashboard +
    // Belege + Bank statt). Auch nicht in der Sidebar für Teams ohne
    // Rechnungs-/Reports-Sicht.
    ...(!isAccountant && canSeeReports
      ? ([{
          href: "/dashboard/tax-advisor" as const,
          label: t("taxAdvisor"),
          icon: UserCheck,
          // Monatsabschluss lebt unter /firm/closing, hat aber keinen
          // eigenen Sidebar-Eintrag für Nicht-Berater — daher highlightet
          // „Steuerberater" auch dort, damit der User seinen Kontext sieht.
          // (Berater haben hier ihre eigene „Kanzlei"-Sektion, dieser
          // Eintrag ist für sie ohnehin ausgeblendet.)
          activePaths: ["/dashboard/firm"],
        }] satisfies NavItem[])
      : []),
    ...(isAdminOrAbove && canSeeTeam
      ? ([{ href: "/dashboard/team" as const, label: t("team"), icon: Users }] satisfies NavItem[])
      : []),
    ...(canSeeAuditLog
      ? ([{ href: "/dashboard/audit-log" as const, label: t("auditLog"), icon: ScrollText }] satisfies NavItem[])
      : []),
    // „Einstellungen" lebt nicht mehr hier, sondern als angepinnter Eintrag am
    // unteren Sidebar-Rand; die Unterseiten haben eine eigene sekundäre
    // Navigation auf der Settings-Seite (settings/layout.tsx).
  ];

  return (
    <aside
      className={cn(
        "relative shrink-0 h-full flex flex-col bg-card border-r border-border transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Collapse-Toggle — kleiner Pfeil direkt auf der Sidebar-Kante, auf Höhe
          des Logos. Ersetzt den früheren „Einklappen"-Button am unteren Rand. */}
      <button
        onClick={onToggle}
        title={collapsed ? t("expand") : t("collapse")}
        aria-label={collapsed ? t("expand") : t("collapse")}
        className="absolute top-5 -right-3 z-50 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground hover:bg-accent transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5" />
        ) : (
          <ChevronLeft className="w-3.5 h-3.5" />
        )}
      </button>

      {/* Logo — Klick auf Logo oder Name führt zurück aufs Dashboard. */}
      <div
        className={cn(
          "h-16 flex items-center border-b border-border overflow-hidden",
          collapsed ? "px-3 justify-center" : "px-4"
        )}
      >
        <Link
          href="/dashboard"
          aria-label={appConfig.name}
          className="flex items-center gap-3 min-w-0 rounded-md hover:opacity-90 transition-opacity"
        >
          <img
            src="/logo-rbg.png"
            alt={appConfig.name}
            className="w-10 h-10 shrink-0 rounded-md object-contain"
          />
          {!collapsed && (
            <span className="font-poppins font-semibold text-xl truncate text-foreground">
              {appConfig.name}
            </span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {navItems.map((item) => {
          // A parent counts as active either when the pathname is inside its
          // own href (most groups), or when it matches any of its children's
          // hrefs — the latter handles "virtual" parents like "Aufträge"
          // whose own href has no matching route (its children live under
          // /dashboard/quotes and /dashboard/order-confirmations).
          const matchesActivePath =
            item.activePaths?.some(
              (p) => pathname === p || pathname.startsWith(`${p}/`),
            ) ?? false;
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href) ||
              matchesActivePath ||
              (item.children?.some((c) =>
                pathname === c.href || pathname.startsWith(`${c.href}/`),
              ) ?? false);
          const Icon = item.icon;
          // Sub-items only render when the parent section is active AND the
          // sidebar is expanded. Collapsed sidebar stays a single column.
          const showChildren = !collapsed && isActive && item.children && item.children.length > 0;

          const hasChildren = item.children && item.children.length > 0;
          // Only items with children get the flyout treatment; leaf items
          // (Clients, Taxes etc.) already work fine with just the tooltip.
          const flyoutEnabled = collapsed && hasChildren;

          return (
            <div
              key={item.href}
              onMouseEnter={(e) => {
                if (!flyoutEnabled) return;
                const rect = e.currentTarget.getBoundingClientRect();
                openFlyout(item.href, rect.top);
              }}
              onMouseLeave={() => {
                if (flyoutEnabled) scheduleClose();
              }}
            >
              <Link
                href={item.linkHref ?? item.href}
                title={collapsed ? item.label : undefined}
                data-onboarding={item.onboardingId}
                className={cn(
                  "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
                  collapsed ? "px-3 py-2.5 justify-center" : "px-3 py-2.5",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="flex-1">{item.label}</span>}
              </Link>
              {showChildren && (
                <div className="mt-0.5 ml-4 pl-3 border-l border-border space-y-0.5">
                  {item.children!.map((child) => {
                    const ChildIcon = child.icon;
                    // The "parent root" child (href === item.href) is active only
                    // when no deeper sibling-child prefix matches. This generalises
                    // the exclusion so /documents doesn't light up on /documents/assets
                    // and /invoices doesn't light up on /invoices/recurring.
                    const siblingPrefixes = item.children!
                      .filter((c) => c.href !== item.href)
                      .map((c) => c.href);
                    const childActive =
                      child.href === item.href
                        ? pathname === child.href ||
                          (pathname.startsWith(`${child.href}/`) &&
                            !siblingPrefixes.some((p) => pathname.startsWith(p)))
                        : pathname === child.href || pathname.startsWith(`${child.href}/`);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                          childActive
                            ? "text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent"
                        )}
                      >
                        <ChildIcon className="w-4 h-4 shrink-0" />
                        <span>{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/*
        Collapsed-sidebar flyout — rendered at the <aside> level (not
        inside <nav>) so it escapes nav's overflow-x clipping without
        needing a portal. Position is `fixed` keyed off the trigger's
        viewport top captured in onMouseEnter; `left` is hard-coded to
        the collapsed sidebar's width (4rem = w-16). High z-index so
        the popover sits above any page content that thinks it's
        special.
      */}
      {collapsed && flyout && (() => {
        const item = navItems.find((n) => n.href === flyout.href);
        if (!item || !item.children) return null;
        return (
          <div
            className="fixed z-50 left-16 pl-1"
            style={{ top: flyout.top }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="min-w-[180px] py-1 bg-card border border-border rounded-lg shadow-lg">
              <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                {item.label}
              </div>
              {item.children.map((child) => {
                const ChildIcon = child.icon;
                // Mirror the active-detection logic from the inline
                // sub-nav so the flyout highlights the current page
                // consistently with the expanded sidebar.
                const siblingPrefixes = item.children!
                  .filter((c) => c.href !== item.href)
                  .map((c) => c.href);
                const childActive =
                  child.href === item.href
                    ? pathname === child.href ||
                      (pathname.startsWith(`${child.href}/`) &&
                        !siblingPrefixes.some((p) => pathname.startsWith(p)))
                    : pathname === child.href || pathname.startsWith(`${child.href}/`);
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    onClick={() => setFlyout(null)}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 text-sm font-medium transition-colors",
                      childActive
                        ? "text-primary bg-primary/5"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent",
                    )}
                  >
                    <ChildIcon className="w-4 h-4 shrink-0" />
                    <span>{child.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Einstellungen — am unteren Rand angepinnt (dedizierter Platz, wie in
          vielen Apps gewohnt). Die Unterseiten haben eine eigene sekundäre
          Navigation auf der Settings-Seite (settings/layout.tsx). */}
      {canSeeSettings && (
        <div className="p-2 border-t border-border">
          <Link
            href="/dashboard/settings"
            data-onboarding="nav-settings"
            title={collapsed ? t("settings") : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
              collapsed ? "px-3 py-2.5 justify-center" : "px-3 py-2.5",
              pathname.startsWith("/dashboard/settings")
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            <Settings className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="flex-1">{t("settings")}</span>}
          </Link>
        </div>
      )}
    </aside>
  );
}
