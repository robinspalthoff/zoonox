/**
 * Cash-Flow-Prognose — regelbasierter Algorithmus (kein ML).
 *
 * Drei Datenquellen, deterministisch verrechnet:
 *   1. Aktueller Kontostand (Summe aller aktiven Bankkonten).
 *   2. Offene Ausgangsrechnungen (SENT / OVERDUE) → bekannter zukünftiger
 *      Eingang, terminiert auf das Fälligkeitsdatum.
 *   3. Wiederkehrende Ausgaben — aus Belegen der letzten 90 Tage per
 *      Mustererkennung (gleicher Lieferant, Betrag ±5 %, regelmäßige
 *      Kadenz) in die Zukunft projiziert.
 *
 * Daraus entsteht eine tägliche 90-Tage-Projektion des Kontostands plus
 * eine 30-Tage-Historie des tatsächlichen Verlaufs. Alles bewusst als
 * reine Funktionen gehalten — keine DB-, keine React-Abhängigkeit — damit
 * die Logik isoliert testbar bleibt und der Server sie nur noch füttert.
 */

// Wie weit die tatsächliche (durchgezogene) Linie zurückreicht.
export const HISTORY_DAYS = 30;
// Prognosehorizont der gestrichelten Linie.
export const FORECAST_DAYS = 90;
// Toleranz, innerhalb derer zwei Belegbeträge als "gleich" gelten.
const AMOUNT_TOLERANCE = 0.05;
// Eine Ausgabengruppe gilt erst ab so vielen Vorkommen als wiederkehrend.
const MIN_OCCURRENCES = 2;
// Akzeptierter Bereich für die mittlere Kadenz (in Tagen). Deckt
// wöchentlich (~7), 14-täglich (~14) und monatlich (~30) ab.
const MIN_INTERVAL_DAYS = 5;
const MAX_INTERVAL_DAYS = 45;
// Überfällige / undatierte Forderungen werden nicht "nie", sondern in
// diesem Fenster als Eingang angenommen — sie sind schließlich fällig.
const OVERDUE_INFLOW_OFFSET_DAYS = 7;

// ─── Eingabe-Typen (DB-nah, aber entkoppelt) ─────────────────────────────────

export interface ExpenseDocInput {
  /** Erkanntes / bestätigtes Belegdatum. */
  date: Date;
  /** Bruttobetrag der Ausgabe (positiv). */
  amount: number;
  /** Stabiler Lieferantenschlüssel (contactId bevorzugt, sonst Name). */
  supplierKey: string;
  /** Anzeigename des Lieferanten. */
  supplierName: string;
}

export interface OpenInvoiceInput {
  /** Bruttobetrag der Forderung (positiv). */
  total: number;
  /** Fälligkeitsdatum; null → wird wie überfällig behandelt. */
  dueDate: Date | null;
  /** True für OVERDUE-Rechnungen. */
  overdue: boolean;
}

export interface BankTxInput {
  date: Date;
  /** Positiv = Eingang, negativ = Ausgang. */
  amount: number;
}

// ─── Ausgabe-Typen ───────────────────────────────────────────────────────────

export interface ForecastPoint {
  /** ISO-Datum (start-of-day, UTC). */
  date: string;
  balance: number;
}

export interface RecurringExpense {
  supplierName: string;
  /** Projizierter (mittlerer) Betrag pro Vorkommen. */
  amount: number;
  /** Nächstes erwartetes Fälligkeitsdatum (ISO). */
  nextDate: string;
  /** Mittlere Kadenz in Tagen (für die UI: "~monatlich"). */
  intervalDays: number;
}

export interface CashflowForecast {
  /** Hat der Algorithmus überhaupt verwertbare Daten gesehen? */
  hasData: boolean;
  currentBalance: number;
  /** Tatsächlicher Verlauf der letzten HISTORY_DAYS Tage (durchgezogen). */
  history: ForecastPoint[];
  /** Projektion über FORECAST_DAYS Tage (gestrichelt); startet bei "heute". */
  forecast: ForecastPoint[];
  /** Saldo-Marken bei 30 / 60 / 90 Tagen. */
  milestones: { day: number; balance: number }[];
  /** Verfügbares Liquiditätskissen = projizierter Tiefstand über 90 Tage. */
  cushion: number;
  /** Datum des Tiefstands (ISO) — für den UI-Hinweis. */
  cushionDate: string;
  /** Summe der projizierten wiederkehrenden Ausgaben der nächsten 30 Tage. */
  upcomingExpenseTotal: number;
  /** Anzahl projizierter Ausgaben-Vorkommen in den nächsten 30 Tagen. */
  upcomingExpenseCount: number;
  /** Erkannte wiederkehrende Ausgaben (für die "nächste Ausgaben"-Zeile). */
  recurring: RecurringExpense[];
  /** Summe aller offenen Forderungen. */
  openInvoiceTotal: number;
  openInvoiceCount: number;
}

// ─── Datums-Helfer (UTC, tag-genau) ──────────────────────────────────────────

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** Addiert Monate, klemmt den Tag auf das Monatsende (28.–31.). */
function addMonthsClamped(d: Date, n: number): Date {
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000);
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ─── Mustererkennung: wiederkehrende Ausgaben ────────────────────────────────

/**
 * Findet wiederkehrende Ausgaben in den Belegen der letzten 90 Tage.
 *
 * Regel pro Lieferant: mindestens MIN_OCCURRENCES Belege, deren Beträge
 * innerhalb ±5 % um den Median liegen, und deren mittlerer Abstand in
 * einem plausiblen Kadenz-Fenster (5–45 Tage) liegt. Aus dieser Gruppe
 * wird die nächste Fälligkeit fortgeschrieben — monatliche Kadenz wird
 * auf denselben Tag-im-Monat geankert, sonst per festem Intervall.
 */
export function detectRecurringExpenses(
  docs: ExpenseDocInput[],
  now: Date,
): RecurringExpense[] {
  const groups = new Map<string, ExpenseDocInput[]>();
  for (const doc of docs) {
    if (!(doc.amount > 0)) continue;
    const list = groups.get(doc.supplierKey);
    if (list) list.push(doc);
    else groups.set(doc.supplierKey, [doc]);
  }

  const result: RecurringExpense[] = [];

  for (const list of groups.values()) {
    if (list.length < MIN_OCCURRENCES) continue;

    // Beträge ±5 % um den Median → "gleicher Betrag".
    const med = median(list.map((d) => d.amount));
    if (med <= 0) continue;
    const consistent = list.filter(
      (d) => Math.abs(d.amount - med) / med <= AMOUNT_TOLERANCE,
    );
    if (consistent.length < MIN_OCCURRENCES) continue;

    // Chronologisch; Abstände der aufeinanderfolgenden Vorkommen.
    const sorted = [...consistent].sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(diffDays(sorted[i].date, sorted[i - 1].date));
    }
    const interval = Math.round(median(intervals));
    if (interval < MIN_INTERVAL_DAYS || interval > MAX_INTERVAL_DAYS) continue;

    const last = sorted[sorted.length - 1];
    const monthly = interval >= 25 && interval <= 35;

    // Nächste Fälligkeit ≥ heute fortschreiben.
    let next = monthly ? addMonthsClamped(last.date, 1) : addDays(last.date, interval);
    let guard = 0;
    while (diffDays(next, now) < 0 && guard < 24) {
      next = monthly ? addMonthsClamped(next, 1) : addDays(next, interval);
      guard++;
    }

    result.push({
      supplierName: last.supplierName,
      amount: med,
      nextDate: startOfDay(next).toISOString(),
      intervalDays: interval,
    });
  }

  // Frühestes zuerst — die UI zeigt die nächste anstehende Ausgabe oben.
  result.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  return result;
}

/** Alle projizierten Ausgaben-Termine (Datum + Betrag) im Horizont. */
function projectExpenseEvents(
  recurring: RecurringExpense[],
  now: Date,
  horizonEnd: Date,
): { date: Date; amount: number }[] {
  const events: { date: Date; amount: number }[] = [];
  for (const r of recurring) {
    const monthly = r.intervalDays >= 25 && r.intervalDays <= 35;
    let d = startOfDay(new Date(r.nextDate));
    let guard = 0;
    while (d.getTime() <= horizonEnd.getTime() && guard < 60) {
      if (diffDays(d, now) >= 0) events.push({ date: d, amount: r.amount });
      d = monthly ? addMonthsClamped(d, 1) : addDays(d, r.intervalDays);
      guard++;
    }
  }
  return events;
}

/** Erwartete Rechnungseingänge auf Termine abbilden. */
function projectInvoiceEvents(
  invoices: OpenInvoiceInput[],
  now: Date,
): { date: Date; amount: number }[] {
  const today = startOfDay(now);
  return invoices
    .filter((inv) => inv.total > 0)
    .map((inv) => {
      // Überfällig / kein / vergangenes Fälligkeitsdatum → in Kürze erwartet.
      let when =
        inv.dueDate && !inv.overdue ? startOfDay(inv.dueDate) : addDays(today, OVERDUE_INFLOW_OFFSET_DAYS);
      if (when.getTime() < today.getTime()) when = addDays(today, OVERDUE_INFLOW_OFFSET_DAYS);
      return { date: when, amount: inv.total };
    });
}

// ─── Hauptfunktion ───────────────────────────────────────────────────────────

export function buildCashflowForecast(params: {
  currentBalance: number;
  /** Bank-Transaktionen der letzten HISTORY_DAYS Tage (nicht IGNORED). */
  recentTx: BankTxInput[];
  openInvoices: OpenInvoiceInput[];
  expenseDocs: ExpenseDocInput[];
  /** Existieren überhaupt Bankkonten? Trennt "leer" von "0 €". */
  hasAccounts: boolean;
  now?: Date;
}): CashflowForecast {
  const { currentBalance, recentTx, openInvoices, expenseDocs, hasAccounts } = params;
  const now = params.now ?? new Date();
  const today = startOfDay(now);
  const historyStart = addDays(today, -HISTORY_DAYS);
  const horizonEnd = addDays(today, FORECAST_DAYS);

  // ── Historie rekonstruieren ────────────────────────────────────────────
  // Tages-Deltas der jüngsten Transaktionen sammeln …
  const dayDelta = new Map<number, number>();
  let txWithinWindow = 0;
  for (const tx of recentTx) {
    const d = startOfDay(tx.date);
    if (d.getTime() < historyStart.getTime() || d.getTime() > today.getTime()) continue;
    const key = diffDays(d, historyStart);
    dayDelta.set(key, (dayDelta.get(key) ?? 0) + tx.amount);
    txWithinWindow += tx.amount;
  }
  // … und vom heutigen Stand rückwärts auf den Fensteranfang schließen.
  const balanceAtStart = currentBalance - txWithinWindow;

  const history: ForecastPoint[] = [];
  let running = balanceAtStart;
  for (let i = 0; i <= HISTORY_DAYS; i++) {
    running += dayDelta.get(i) ?? 0;
    history.push({ date: addDays(historyStart, i).toISOString(), balance: round2(running) });
  }

  // ── Zukunfts-Events ────────────────────────────────────────────────────
  const recurring = detectRecurringExpenses(expenseDocs, now);
  const expenseEvents = projectExpenseEvents(recurring, now, horizonEnd);
  const invoiceEvents = projectInvoiceEvents(openInvoices, now);

  const futureDelta = new Map<number, number>();
  for (const e of expenseEvents) {
    const k = diffDays(e.date, today);
    if (k >= 0 && k <= FORECAST_DAYS) futureDelta.set(k, (futureDelta.get(k) ?? 0) - e.amount);
  }
  for (const e of invoiceEvents) {
    const k = diffDays(e.date, today);
    if (k >= 0 && k <= FORECAST_DAYS) futureDelta.set(k, (futureDelta.get(k) ?? 0) + e.amount);
  }

  // ── Projektion (Tag 0 = heute, knüpft an die Historie an) ───────────────
  const forecast: ForecastPoint[] = [];
  let proj = currentBalance;
  let cushion = currentBalance;
  let cushionDate = today.toISOString();
  for (let i = 0; i <= FORECAST_DAYS; i++) {
    proj += futureDelta.get(i) ?? 0;
    const iso = addDays(today, i).toISOString();
    forecast.push({ date: iso, balance: round2(proj) });
    if (proj < cushion) {
      cushion = proj;
      cushionDate = iso;
    }
  }

  const milestones = [30, 60, 90].map((day) => ({
    day,
    balance: forecast[day]?.balance ?? proj,
  }));

  // ── Zusammenfassungen für die drei Zeilen ───────────────────────────────
  const in30 = addDays(today, 30);
  const upcoming = expenseEvents.filter((e) => e.date.getTime() <= in30.getTime());
  const upcomingExpenseTotal = round2(upcoming.reduce((s, e) => s + e.amount, 0));
  const openInvoiceTotal = round2(openInvoices.reduce((s, inv) => s + inv.total, 0));

  return {
    hasData: hasAccounts || recentTx.length > 0 || openInvoices.length > 0,
    currentBalance: round2(currentBalance),
    history,
    forecast,
    milestones,
    cushion: round2(cushion),
    cushionDate,
    upcomingExpenseTotal,
    upcomingExpenseCount: upcoming.length,
    recurring,
    openInvoiceTotal,
    openInvoiceCount: openInvoices.length,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
