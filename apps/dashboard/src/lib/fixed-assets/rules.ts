// AfA / fixed-asset business rules.
//
// Kept country-agnostic by design: every constant is exported as a const so a
// later `rules/de.ts`, `rules/at.ts`, … split can override defaults per tenant
// country without touching the call sites. For the MVP only the DE BMF
// AfA-Tabelle values are present.

import type { FixedAssetCategory, FixedAssetMethod, SkrType } from "@prisma/client";

// ── GWG threshold (Geringwertige Wirtschaftsgüter) ──────────────────────────
// § 6 Abs. 2 EStG (Deutschland, Stand 2026): Sofortabschreibung bis 800 € netto.
// Wird zentral hier gehalten, damit eine spätere Landes-Regel das übersteuern kann.
export const GWG_NET_THRESHOLD = 800;

// ── Default Nutzungsdauer pro Kategorie (Monate) ────────────────────────────
// Basis: BMF AfA-Tabelle "AV" (allgemein verwendbare Anlagegüter). Werte sind
// nur Defaults — der User kann beim Anlegen einer Anlage übersteuern.
export const DEFAULT_USEFUL_LIFE_MONTHS: Record<FixedAssetCategory, number> = {
  TANGIBLE:    13 * 12, // 13 Jahre (Büromöbel BMF AV-Tabelle Pos. 6.1.4)
  IT_HARDWARE:  3 * 12, // 3 Jahre  (BMF-Schreiben digitale WG, dig. Wirtschaftsgüter)
  IT_SOFTWARE:  3 * 12, // 3 Jahre  (analog dig. WG)
  VEHICLE:      6 * 12, // 6 Jahre  (PKW BMF AV-Tabelle Pos. 4.2.1)
  MACHINERY:    8 * 12, // 8 Jahre  (Allgemeine Maschinen, AV-Tabelle Pos. 3)
  BUILDING:    33 * 12, // 33 Jahre (§ 7 Abs. 4 Nr. 2 EStG, 3% p.a.)
  INTANGIBLE:   5 * 12, // 5 Jahre  (allg. Erfahrungssatz)
  OTHER:       10 * 12, // 10 Jahre (konservativer Default)
};

// ── SKR-Konten je Kategorie ─────────────────────────────────────────────────
// Soll-Konto bei Anschaffung (Aktivierung) — passive Sachanlagen-Klasse 0.
// Quelle: SKR03/SKR04 Kontenrahmen Stand 2026.

interface AssetAccounts {
  /** Aktivkonto (Soll bei Anschaffung). */
  asset: string;
  /** Abschreibungs-Aufwandskonto (Soll bei monatlicher AfA). */
  depreciation: string;
  /** Sofortabschreibungs-Konto (Soll bei IMMEDIATE / GWG). */
  immediate: string;
}

const SKR03_ACCOUNTS: Record<FixedAssetCategory, AssetAccounts> = {
  TANGIBLE:    { asset: "0420", depreciation: "4830", immediate: "4855" }, // Büroeinrichtung
  IT_HARDWARE: { asset: "0490", depreciation: "4830", immediate: "4855" }, // Sonst. Betriebs- u. Geschäftsausstattung (genutzt für IT)
  IT_SOFTWARE: { asset: "0027", depreciation: "4822", immediate: "4855" }, // EDV-Software → immat. VG → 4822
  VEHICLE:     { asset: "0320", depreciation: "4830", immediate: "4855" }, // PKW
  MACHINERY:   { asset: "0210", depreciation: "4830", immediate: "4855" }, // Maschinen
  BUILDING:    { asset: "0090", depreciation: "4830", immediate: "4855" }, // Geschäftsbauten
  INTANGIBLE:  { asset: "0025", depreciation: "4822", immediate: "4855" }, // Sonst. immat. VG
  OTHER:       { asset: "0490", depreciation: "4830", immediate: "4855" },
};

const SKR04_ACCOUNTS: Record<FixedAssetCategory, AssetAccounts> = {
  TANGIBLE:    { asset: "0650", depreciation: "6220", immediate: "6260" }, // Andere Betriebs- u. Geschäftsausstattung
  IT_HARDWARE: { asset: "0670", depreciation: "6220", immediate: "6260" },
  IT_SOFTWARE: { asset: "0135", depreciation: "6200", immediate: "6260" }, // EDV-Software → 6200 Abschr. immat. VG
  VEHICLE:     { asset: "0520", depreciation: "6220", immediate: "6260" },
  MACHINERY:   { asset: "0440", depreciation: "6220", immediate: "6260" },
  BUILDING:    { asset: "0235", depreciation: "6220", immediate: "6260" },
  INTANGIBLE:  { asset: "0130", depreciation: "6200", immediate: "6260" },
  OTHER:       { asset: "0670", depreciation: "6220", immediate: "6260" },
};

export function accountsFor(skr: SkrType, category: FixedAssetCategory): AssetAccounts {
  return skr === "SKR03" ? SKR03_ACCOUNTS[category] : SKR04_ACCOUNTS[category];
}

// ── Method derivation ───────────────────────────────────────────────────────
// Pre-fills a sensible method given the net amount. The user can always
// override in the form. We *suggest* IMMEDIATE if the asset is GWG-eligible,
// LINEAR otherwise. POOL/DEGRESSIVE are reserved for future work and never
// auto-selected.
export function suggestMethod(netAmount: number): FixedAssetMethod {
  return netAmount <= GWG_NET_THRESHOLD ? "IMMEDIATE" : "LINEAR";
}

// ── OCR threshold for the "treat as asset?" banner in the document UI ──────
// Lower than the GWG cap so users see the hint for everything that *could*
// be an asset — including borderline cases just above the GWG limit.
export const ASSET_HINT_NET_THRESHOLD = 250;
