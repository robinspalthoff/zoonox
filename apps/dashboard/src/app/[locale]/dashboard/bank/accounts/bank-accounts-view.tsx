"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import {
  Plus,
  Pencil,
  Trash2,
  Landmark,
  Star,
  ArrowLeft,
  Building2,
  Scale,
  FileSpreadsheet,
  PencilLine,
  CheckCircle2,
  Info,
  Upload,
  SkipForward,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { formatIban, isValidIban } from "@/lib/bank-utils";
import { upsertBankAccount, deleteBankAccount } from "../actions";
import { ColumnMapper } from "../[accountId]/column-mapper";
import { EnableBankingConnectPanel, BankConnectStatus } from "./bank-connect";
import {
  BankConnectionsSection,
  type BankConnectionRow,
} from "./bank-connections";
import type { CsvMappingPreset } from "@/lib/csv-mapping";
import { cn } from "@/lib/utils";

type BankAccountType = "BANK" | "CLEARING";

interface BankAccountRow {
  id: string;
  name: string;
  type: BankAccountType;
  bankName: string | null;
  iban: string | null;
  bic: string | null;
  currency: string;
  openingBalance: number;
  bookingAccount: string | null;
  isDefault: boolean;
  isActive: boolean;
  balance: number;
  transactionCount: number;
}

// The bank step can show the picker (subform === null) OR an inline form
// (subform === "manual" | "csv"). The "csv" subform is itself a 2-step
// micro-wizard: first the account details, then an optional sample-CSV
// upload to capture the column mapping for reuse on later imports.
type BankSubform = null | "manual" | "csv";

// Within the CSV subform, we're either gathering the bank details
// ("details") or capturing a column mapping from a sample file
// ("mapping"). The mapping step is skippable — users who don't have
// a sample file handy can finish now and map columns on the first
// real import.
type CsvStep = "details" | "mapping";

type WizardStep =
  | { kind: "chooser" }
  | { kind: "bank"; subform: BankSubform }
  | { kind: "clearing" };

export function BankAccountsView({
  accounts,
  connections = [],
}: {
  accounts: BankAccountRow[];
  connections?: BankConnectionRow[];
}) {
  const t = useTranslations("bank.accounts");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Modal / wizard state
  const [editingAccount, setEditingAccount] = useState<BankAccountRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [step, setStep] = useState<WizardStep>({ kind: "chooser" });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Shared form fields
  const [name, setName] = useState("");
  const [bankName, setBankName] = useState("");
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [bookingAccount, setBookingAccount] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [ibanError, setIbanError] = useState(false);

  // CSV sub-wizard state — only meaningful when step.subform === "csv".
  const [csvStep, setCsvStep] = useState<CsvStep>("details");
  // Hold raw bytes so the ColumnMapper can re-decode with a user-chosen
  // encoding (UTF-8 vs Windows-1252 etc.) live in Importoptionen.
  const [csvSampleBytes, setCsvSampleBytes] = useState<ArrayBuffer | null>(null);
  const [csvSampleError, setCsvSampleError] = useState<string | null>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);

  function resetForm() {
    setName("");
    setBankName("");
    setIban("");
    setBic("");
    setOpeningBalance("0");
    setBookingAccount("");
    setIsDefault(false);
    setIbanError(false);
    setCsvStep("details");
    setCsvSampleBytes(null);
    setCsvSampleError(null);
  }

  function openAddWizard() {
    setEditingAccount(null);
    resetForm();
    setStep({ kind: "chooser" });
    setShowForm(true);
  }

  function openEdit(account: BankAccountRow) {
    setEditingAccount(account);
    setName(account.name);
    setBankName(account.bankName || "");
    setIban(account.iban ? formatIban(account.iban) : "");
    setBic(account.bic || "");
    setOpeningBalance(String(account.openingBalance));
    setBookingAccount(account.bookingAccount || "");
    setIsDefault(account.isDefault);
    setIbanError(false);
    // Skip chooser — jump straight to the matching form.
    if (account.type === "CLEARING") {
      setStep({ kind: "clearing" });
    } else {
      setStep({ kind: "bank", subform: "manual" });
    }
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingAccount(null);
  }

  function submit(payload: Parameters<typeof upsertBankAccount>[0]) {
    startTransition(async () => {
      const result = await upsertBankAccount(payload);
      if (result.success) {
        closeForm();
        router.refresh();
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteBankAccount(id);
      setDeleteConfirmId(null);
      router.refresh();
    });
  }

  // ── Submitters for each form ────────────────────────────────────────────────

  function submitManualBank(e: React.FormEvent) {
    e.preventDefault();
    const cleanIban = iban.replace(/\s/g, "");
    if (cleanIban && !isValidIban(cleanIban)) {
      setIbanError(true);
      return;
    }
    submit({
      id: editingAccount?.id,
      type: "BANK",
      name,
      bankName: bankName || null,
      iban: cleanIban || null,
      bic: bic || null,
      openingBalance: parseFloat(openingBalance) || 0,
      bookingAccount: bookingAccount || null,
      isDefault,
    });
  }

  /**
   * CSV flow, step 1: validate the bank details and advance to the
   * mapping sub-step. We don't save the account yet — saving only
   * happens when the user finishes the mapping step (with or without
   * a preset). This keeps account creation as a single atomic
   * commit, so if the user backs out or closes the modal they don't
   * leave a half-configured account behind.
   */
  function submitCsvBankDetails(e: React.FormEvent) {
    e.preventDefault();
    const cleanIban = iban.replace(/\s/g, "");
    if (cleanIban && !isValidIban(cleanIban)) {
      setIbanError(true);
      return;
    }
    // Booking account is required for CSV accounts — mirror the
    // server-side check client-side so the user sees the error
    // immediately rather than after a round trip.
    if (!bookingAccount.trim()) return;
    setCsvStep("mapping");
  }

  /**
   * CSV flow, step 2 (happy path): persist the account together with
   * the preset we just captured.
   */
  function submitCsvBankWithMapping(preset: CsvMappingPreset) {
    submit({
      id: editingAccount?.id,
      type: "BANK",
      name,
      bankName: bankName || null,
      iban: iban.replace(/\s/g, "") || null,
      bookingAccount: bookingAccount || null,
      isDefault,
      requireBookingAccount: true,
      csvMapping: preset,
    });
  }

  /**
   * CSV flow, step 2 (skip path): persist the account without a preset.
   * The user will be prompted to map columns on the first real import,
   * and the "save for next time" checkbox there will populate the
   * preset retroactively.
   */
  function skipCsvMapping() {
    submit({
      id: editingAccount?.id,
      type: "BANK",
      name,
      bankName: bankName || null,
      iban: iban.replace(/\s/g, "") || null,
      bookingAccount: bookingAccount || null,
      isDefault,
      requireBookingAccount: true,
    });
  }

  function submitClearing(e: React.FormEvent) {
    e.preventDefault();
    submit({
      id: editingAccount?.id,
      type: "CLEARING",
      name,
      bookingAccount: bookingAccount || null,
      openingBalance: parseFloat(openingBalance) || 0,
      isDefault,
    });
  }

  // Back-button target within the bank step. The CSV subform has its
  // own 2-step inner flow, so backing out of "mapping" returns to
  // "details" rather than all the way to the picker.
  function backInsideBank() {
    if (step.kind !== "bank") return;
    if (step.subform === "csv" && csvStep === "mapping") {
      setCsvStep("details");
      setCsvSampleBytes(null);
      setCsvSampleError(null);
      return;
    }
    if (step.subform) {
      setStep({ kind: "bank", subform: null });
      setCsvStep("details");
    } else {
      setStep({ kind: "chooser" });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
        Page header — matches the app-wide convention used on clients,
        settings, invoices etc. `text-2xl font-semibold` H1 left, primary
        CTA right.
      */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <button
          onClick={openAddWizard}
          className="inline-flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t("add")}
        </button>
      </div>

      <BankConnectStatus />
      <BankConnectionsSection connections={connections} />

      {/* Account Cards */}
      {accounts.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Landmark className="w-10 h-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="group p-4 bg-card border border-border rounded-lg hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <Link
                  href={`/dashboard/bank/${acc.id}`}
                  className="flex-1 min-w-0"
                >
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-medium text-sm group-hover:text-primary transition-colors">
                      {acc.name}
                    </h3>
                    {acc.isDefault && (
                      <Star className="w-3 h-3 text-primary fill-primary" />
                    )}
                    {acc.type === "CLEARING" && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 bg-muted text-muted-foreground rounded">
                        {t("clearingBadge")}
                      </span>
                    )}
                  </div>
                  {acc.bankName && (
                    <p className="text-xs text-muted-foreground">{acc.bankName}</p>
                  )}
                </Link>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button
                    onClick={() => openEdit(acc)}
                    className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    title={t("edit")}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(acc.id)}
                    className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-destructive transition-colors"
                    title={t("delete")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {acc.iban && (
                <p className="text-xs text-muted-foreground font-mono mb-2">
                  {formatIban(acc.iban)}
                </p>
              )}
              <p className="text-lg font-semibold mb-1">{formatCurrency(acc.balance)}</p>
              <p className="text-xs text-muted-foreground">
                {acc.transactionCount} {t("transactionsCountSuffix")}
              </p>
              {deleteConfirmId === acc.id && (
                <div className="mt-3 p-2 bg-destructive/10 rounded text-xs text-destructive">
                  {t("deleteConfirm")}
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleDelete(acc.id)}
                      disabled={isPending}
                      className="px-2 py-1 bg-destructive text-destructive-foreground rounded text-xs font-medium"
                    >
                      {t("delete")}
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="px-2 py-1 bg-muted rounded text-xs"
                    >
                      {t("cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Wizard Modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeForm}
        >
          <div
            className={cn(
              "bg-card border border-border rounded-xl shadow-lg w-full max-h-[90vh] overflow-y-auto",
              // The column mapper needs more horizontal room than the
              // default form layout; widen the modal while it's active.
              step.kind === "bank" && step.subform === "csv" && csvStep === "mapping"
                ? "max-w-4xl"
                : "max-w-2xl",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
              {!editingAccount && step.kind !== "chooser" && (
                <button
                  onClick={
                    step.kind === "bank"
                      ? backInsideBank
                      : () => setStep({ kind: "chooser" })
                  }
                  className="p-1 -ml-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  title={t("addDialog.back")}
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <h3 className="text-xl font-semibold tracking-tight">
                {editingAccount
                  ? t("edit")
                  : step.kind === "chooser"
                    ? t("addDialog.title")
                    : step.kind === "clearing"
                      ? t("type.clearing.title")
                      : t("type.bank.title")}
              </h3>
            </div>

            {/* Body */}
            <div className="p-6">
              {step.kind === "chooser" && (
                <ChooserStep
                  onPickBank={() => setStep({ kind: "bank", subform: null })}
                  onPickClearing={() => setStep({ kind: "clearing" })}
                />
              )}

              {step.kind === "bank" && step.subform === null && (
                <BankPicker
                  onPickManual={() => setStep({ kind: "bank", subform: "manual" })}
                  onPickCsv={() => setStep({ kind: "bank", subform: "csv" })}
                />
              )}

              {step.kind === "bank" && step.subform === "manual" && (
                <ManualBankForm
                  name={name}
                  setName={setName}
                  bankName={bankName}
                  setBankName={setBankName}
                  iban={iban}
                  setIban={(v) => {
                    setIban(v);
                    setIbanError(false);
                  }}
                  bic={bic}
                  setBic={setBic}
                  openingBalance={openingBalance}
                  setOpeningBalance={setOpeningBalance}
                  bookingAccount={bookingAccount}
                  setBookingAccount={setBookingAccount}
                  isDefault={isDefault}
                  setIsDefault={setIsDefault}
                  ibanError={ibanError}
                  isPending={isPending}
                  onSubmit={submitManualBank}
                  onCancel={closeForm}
                />
              )}

              {step.kind === "bank" && step.subform === "csv" && csvStep === "details" && (
                <CsvBankForm
                  name={name}
                  setName={setName}
                  bankName={bankName}
                  iban={iban}
                  setIban={(v) => {
                    setIban(v);
                    setIbanError(false);
                  }}
                  bookingAccount={bookingAccount}
                  setBookingAccount={setBookingAccount}
                  ibanError={ibanError}
                  isPending={isPending}
                  onSubmit={submitCsvBankDetails}
                  onCancel={closeForm}
                />
              )}

              {step.kind === "bank" && step.subform === "csv" && csvStep === "mapping" && (
                <CsvMappingStep
                  sampleBytes={csvSampleBytes}
                  sampleError={csvSampleError}
                  fileInputRef={csvFileInputRef}
                  onPickFile={async (file) => {
                    setCsvSampleError(null);
                    const ext = file.name.split(".").pop()?.toLowerCase();
                    if (ext !== "csv" && ext !== "txt") {
                      setCsvSampleError("unsupportedType");
                      return;
                    }
                    try {
                      const bytes = await file.arrayBuffer();
                      setCsvSampleBytes(bytes);
                    } catch {
                      setCsvSampleError("readFailed");
                    }
                  }}
                  onClearFile={() => {
                    setCsvSampleBytes(null);
                    setCsvSampleError(null);
                    if (csvFileInputRef.current) csvFileInputRef.current.value = "";
                  }}
                  isPending={isPending}
                  onBack={() => {
                    setCsvStep("details");
                    setCsvSampleBytes(null);
                    setCsvSampleError(null);
                  }}
                  onSkip={skipCsvMapping}
                  onConfirm={submitCsvBankWithMapping}
                />
              )}

              {step.kind === "clearing" && (
                <ClearingForm
                  name={name}
                  setName={setName}
                  bookingAccount={bookingAccount}
                  setBookingAccount={setBookingAccount}
                  isDefault={isDefault}
                  setIsDefault={setIsDefault}
                  isPending={isPending}
                  onSubmit={submitClearing}
                  onCancel={closeForm}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Chooser (bank vs clearing) ──────────────────────────────────────────────

function ChooserStep({
  onPickBank,
  onPickClearing,
}: {
  onPickBank: () => void;
  onPickClearing: () => void;
}) {
  const t = useTranslations("bank.accounts");
  return (
    <div className="flex flex-col gap-5">
      <p className="text-base text-muted-foreground">{t("addDialog.chooseType")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ChooserCard
          icon={<Building2 className="w-6 h-6" />}
          title={t("type.bank.title")}
          desc={t("type.bank.desc")}
          onClick={onPickBank}
        />
        <ChooserCard
          icon={<Scale className="w-6 h-6" />}
          title={t("type.clearing.title")}
          desc={t("type.clearing.desc")}
          onClick={onPickClearing}
        />
      </div>
    </div>
  );
}

function ChooserCard({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left p-5 border border-border rounded-xl hover:border-primary/50 hover:bg-accent/40 hover:shadow-sm transition-all"
    >
      <div className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-primary/10 text-primary mb-3 group-hover:scale-105 transition-transform">
        {icon}
      </div>
      <h4 className="font-semibold text-base mb-1">{title}</h4>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </button>
  );
}

// ─── Bank picker: 2 action pills + search + logo grid + benefits ───────────

function BankPicker({
  onPickManual,
  onPickCsv,
}: {
  onPickManual: () => void;
  onPickCsv: () => void;
}) {
  const t = useTranslations("bank.accounts");
  const tBanks = useTranslations("bank.accounts.banks");
  const tConnect = useTranslations("bank.connect");

  return (
    <div className="flex flex-col gap-5">
      {/* Primary path: connect directly via open banking. */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-semibold text-foreground">
            {tConnect("wizardTitle")}
          </span>
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
            PSD2
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {tConnect("intro")}
        </p>
        <EnableBankingConnectPanel country="DE" />
      </div>

      {/* Divider with label */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t("bankFlow.orPickBank")}
        </span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Fallback paths: manual entry + CSV import. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <ActionPill
          icon={<PencilLine className="w-4 h-4" />}
          title={t("bankFlow.tab.manual")}
          tooltip={t("bankFlow.manualDesc")}
          onClick={onPickManual}
        />
        <ActionPill
          icon={<FileSpreadsheet className="w-4 h-4" />}
          title={t("bankFlow.tab.csv")}
          tooltip={t("bankFlow.csvDesc")}
          onClick={onPickCsv}
        />
      </div>

      {/* Benefits with checkmarks */}
      <ul className="flex flex-col gap-2.5 p-3.5 bg-muted/40 rounded-xl border border-border">
        <BenefitRow>{tBanks("benefit1")}</BenefitRow>
        <BenefitRow>{tBanks("benefit2")}</BenefitRow>
        <BenefitRow>{tBanks("benefit3")}</BenefitRow>
      </ul>
    </div>
  );
}

function ActionPill({
  icon,
  title,
  tooltip,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex items-center gap-2.5 px-3.5 py-2.5 border border-border rounded-lg bg-background hover:border-primary/50 hover:bg-accent/40 transition-colors text-left"
    >
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 text-primary shrink-0">
        {icon}
      </span>
      <span className="font-medium text-sm flex-1">{title}</span>
      {/*
        Custom tooltip on the info icon. We use a sibling element that opens on
        group-hover/focus-within. The native `title` attribute was unreliable
        (browser delay + parent button intercepting hover state), so we render
        a real floating panel instead. Keyboard users get it via focus-within.
      */}
      <span
        tabIndex={0}
        aria-label={tooltip}
        role="note"
        // group/info scopes the hover so only this icon triggers the tooltip,
        // not the whole pill.
        className="group/info relative inline-flex items-center justify-center w-5 h-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-help shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <Info className="w-3.5 h-3.5" />
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full right-0 mb-2 w-64 p-2.5 rounded-lg bg-popover text-popover-foreground border border-border shadow-lg text-xs leading-relaxed text-left opacity-0 invisible translate-y-1 group-hover/info:opacity-100 group-hover/info:visible group-hover/info:translate-y-0 group-focus-within/info:opacity-100 group-focus-within/info:visible group-focus-within/info:translate-y-0 transition-all duration-150 z-10"
        >
          {tooltip}
        </span>
      </span>
    </button>
  );
}

function BenefitRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
      <span className="text-sm text-foreground leading-relaxed">{children}</span>
    </li>
  );
}

// ─── Shared primitives ──────────────────────────────────────────────────────

export function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="text-sm font-medium">
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-muted/50 border border-border text-sm text-muted-foreground">
      <Info className="w-4 h-4 mt-0.5 shrink-0" />
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}

export function BookingAccountSelect({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const t = useTranslations("bank.accounts.bookingAccount");
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="">{t("placeholder")}</option>
      <optgroup label={t("groupBank")}>
        {range(1800, 1859).map((n) => (
          <option key={n} value={String(n)}>
            {n}
          </option>
        ))}
      </optgroup>
      <optgroup label={t("groupLiabilities")}>
        {range(1700, 1739).map((n) => (
          <option key={n} value={String(n)}>
            {n}
          </option>
        ))}
      </optgroup>
      <optgroup label={t("groupClearing")}>
        {range(2180, 2199).map((n) => (
          <option key={n} value={String(n)}>
            {n}
          </option>
        ))}
      </optgroup>
      <optgroup label={t("groupOther")}>
        <option value="3786">3786</option>
      </optgroup>
    </select>
  );
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

// ── Forms ───────────────────────────────────────────────────────────────────

export function ManualBankForm(props: {
  name: string;
  setName: (v: string) => void;
  bankName: string;
  setBankName: (v: string) => void;
  iban: string;
  setIban: (v: string) => void;
  bic: string;
  setBic: (v: string) => void;
  openingBalance: string;
  setOpeningBalance: (v: string) => void;
  bookingAccount: string;
  setBookingAccount: (v: string) => void;
  isDefault: boolean;
  setIsDefault: (v: boolean) => void;
  ibanError: boolean;
  isPending: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("bank.accounts");
  return (
    <form onSubmit={props.onSubmit} className="flex flex-col gap-4">
      <div>
        <FieldLabel required>{t("name")}</FieldLabel>
        <input
          type="text"
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
          placeholder={t("namePlaceholder")}
          required
          className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <FieldLabel>{t("bankName")}</FieldLabel>
        <input
          type="text"
          value={props.bankName}
          onChange={(e) => props.setBankName(e.target.value)}
          placeholder={t("bankNamePlaceholder")}
          className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <FieldLabel>{t("iban")}</FieldLabel>
        <input
          type="text"
          value={props.iban}
          onChange={(e) => props.setIban(e.target.value)}
          placeholder={t("ibanPlaceholder")}
          className={cn(
            "w-full mt-1 px-3 py-2 bg-background border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring",
            props.ibanError ? "border-destructive" : "border-input",
          )}
        />
        {props.ibanError && (
          <p className="text-xs text-destructive mt-1">{t("ibanInvalid")}</p>
        )}
      </div>
      <div>
        <FieldLabel>{t("bic")}</FieldLabel>
        <input
          type="text"
          value={props.bic}
          onChange={(e) => props.setBic(e.target.value)}
          placeholder={t("bicPlaceholder")}
          className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <FieldLabel>{t("openingBalance")}</FieldLabel>
        <input
          type="number"
          step="0.01"
          value={props.openingBalance}
          onChange={(e) => props.setOpeningBalance(e.target.value)}
          className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <FieldLabel>{t("bookingAccountLabel")}</FieldLabel>
        <BookingAccountSelect
          value={props.bookingAccount}
          onChange={props.setBookingAccount}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={props.isDefault}
          onChange={(e) => props.setIsDefault(e.target.checked)}
          className="rounded border-input"
        />
        {t("isDefault")}
      </label>
      <FormActions isPending={props.isPending} onCancel={props.onCancel} />
    </form>
  );
}

function CsvBankForm(props: {
  name: string;
  setName: (v: string) => void;
  bankName: string;
  iban: string;
  setIban: (v: string) => void;
  bookingAccount: string;
  setBookingAccount: (v: string) => void;
  ibanError: boolean;
  isPending: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("bank.accounts");
  return (
    <form onSubmit={props.onSubmit} className="flex flex-col gap-4">
      <InfoBox>{t("csv.info")}</InfoBox>
      {props.bankName && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
          <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center font-semibold">
            {props.bankName.charAt(0)}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("csv.selectedBank")}</p>
            <p className="text-sm font-medium">{props.bankName}</p>
          </div>
        </div>
      )}
      <div>
        <FieldLabel required>{t("csv.accountName")}</FieldLabel>
        <input
          type="text"
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
          placeholder={t("csv.accountNamePlaceholder")}
          required
          className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <FieldLabel>{t("csv.iban")}</FieldLabel>
        <input
          type="text"
          value={props.iban}
          onChange={(e) => props.setIban(e.target.value)}
          placeholder={t("ibanPlaceholder")}
          className={cn(
            "w-full mt-1 px-3 py-2 bg-background border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring",
            props.ibanError ? "border-destructive" : "border-input",
          )}
        />
        {props.ibanError && (
          <p className="text-xs text-destructive mt-1">{t("ibanInvalid")}</p>
        )}
      </div>
      <div>
        <FieldLabel required>{t("csv.bookingAccount")}</FieldLabel>
        <BookingAccountSelect
          value={props.bookingAccount}
          onChange={props.setBookingAccount}
          required
        />
      </div>
      <FormActions
        isPending={props.isPending}
        onCancel={props.onCancel}
        submitLabel={t("csv.continue")}
      />
    </form>
  );
}

function ClearingForm(props: {
  name: string;
  setName: (v: string) => void;
  bookingAccount: string;
  setBookingAccount: (v: string) => void;
  isDefault: boolean;
  setIsDefault: (v: boolean) => void;
  isPending: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("bank.accounts");
  return (
    <form onSubmit={props.onSubmit} className="flex flex-col gap-4">
      <InfoBox>{t("clearing.info")}</InfoBox>
      <div>
        <FieldLabel required>{t("clearing.accountName")}</FieldLabel>
        <input
          type="text"
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
          placeholder={t("namePlaceholder")}
          required
          className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <FieldLabel required>{t("clearing.bookingAccount")}</FieldLabel>
        <BookingAccountSelect
          value={props.bookingAccount}
          onChange={props.setBookingAccount}
          required
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={props.isDefault}
          onChange={(e) => props.setIsDefault(e.target.checked)}
          className="rounded border-input"
        />
        {t("isDefault")}
      </label>
      <FormActions isPending={props.isPending} onCancel={props.onCancel} />
    </form>
  );
}

export function FormActions({
  isPending,
  onCancel,
  submitLabel,
}: {
  isPending: boolean;
  onCancel: () => void;
  /**
   * Override the default "Save" label. Used by the CSV details step
   * where submit advances to the mapping sub-step rather than
   * persisting the account.
   */
  submitLabel?: string;
}) {
  const t = useTranslations("bank.accounts");
  return (
    <div className="flex justify-end gap-2 mt-2">
      <button
        type="button"
        onClick={onCancel}
        className="px-4 py-2 text-sm rounded-lg hover:bg-accent transition-colors"
      >
        {t("cancel")}
      </button>
      <button
        type="submit"
        disabled={isPending}
        className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {isPending ? "…" : (submitLabel ?? t("save"))}
      </button>
    </div>
  );
}
/**
 * CsvMappingStep — step 2 of the CSV-flavored account creation flow.
 *
 * The user is invited (not required) to upload a sample CSV from
 * their bank. If they do, we render the ColumnMapper and capture a
 * CsvMappingPreset on confirm. If they don't have a file handy,
 * "Skip" finishes the wizard without a preset — the first real
 * import will then fall into the mapper path and offer to save the
 * preset for next time.
 *
 * Why optional
 *   Forcing a sample file at account-creation time blocks users who
 *   are setting things up before their first statement arrives (a
 *   very common pattern for freelancers opening a new bank account).
 *   A skippable step preserves the happy path without closing the
 *   door on users who do have the file open already.
 */
function CsvMappingStep(props: {
  sampleBytes: ArrayBuffer | null;
  sampleError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPickFile: (file: File) => void | Promise<void>;
  onClearFile: () => void;
  isPending: boolean;
  onBack: () => void;
  onSkip: () => void;
  onConfirm: (preset: CsvMappingPreset) => void;
}) {
  const t = useTranslations("bank.accounts");
  const tErr = useTranslations("bank.accounts.csv.mappingStep.errors");

  // Uploaded but not yet mapped → show the mapper. Otherwise show
  // the file picker + skip button.
  if (!props.sampleBytes) {
    return (
      <div className="flex flex-col gap-4">
        <InfoBox>{t("csv.mappingStep.info")}</InfoBox>

        <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
          <Upload className="w-8 h-8 mx-auto text-muted-foreground/60 mb-3" />
          <p className="text-sm font-medium mb-1">{t("csv.mappingStep.uploadTitle")}</p>
          <p className="text-xs text-muted-foreground mb-4">
            {t("csv.mappingStep.uploadHint")}
          </p>
          <input
            ref={props.fileInputRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) props.onPickFile(file);
            }}
          />
          <button
            type="button"
            onClick={() => props.fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Upload className="w-4 h-4" />
            {t("csv.mappingStep.pickFile")}
          </button>
        </div>

        {props.sampleError && (
          <div className="px-3 py-2 bg-destructive/10 text-destructive text-xs rounded">
            {tErr(props.sampleError)}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 mt-2">
          <button
            type="button"
            onClick={props.onBack}
            className="px-4 py-2 text-sm rounded-lg hover:bg-accent transition-colors inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("csv.mappingStep.back")}
          </button>
          <button
            type="button"
            onClick={props.onSkip}
            disabled={props.isPending}
            className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-accent transition-colors inline-flex items-center gap-1 disabled:opacity-50"
          >
            <SkipForward className="w-4 h-4" />
            {props.isPending ? "…" : t("csv.mappingStep.skip")}
          </button>
        </div>
      </div>
    );
  }

  // A sample file is loaded — render the mapper and capture the
  // preset on confirm. The mapper is rendered "full-bleed" inside
  // the wizard body: its internal padding + borders handle layout.
  return (
    <div className="flex flex-col -mx-6 -my-6">
      <div className="px-6 pt-4 pb-2 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t("csv.mappingStep.mapperHint")}
        </p>
        <button
          type="button"
          onClick={props.onClearFile}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          {t("csv.mappingStep.pickDifferent")}
        </button>
      </div>
      <ColumnMapper rawBytes={props.sampleBytes}>
        {({ preset, canConfirm, validPreviewCount }) => (
          <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={props.onBack}
              className="px-4 py-2 text-sm rounded-lg hover:bg-accent transition-colors inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" />
              {t("csv.mappingStep.back")}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={props.onSkip}
                disabled={props.isPending}
                className="px-4 py-2 text-sm rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
              >
                {t("csv.mappingStep.skip")}
              </button>
              <button
                type="button"
                onClick={() => preset && props.onConfirm(preset)}
                disabled={props.isPending || !canConfirm || validPreviewCount === 0}
                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {props.isPending ? "…" : t("csv.mappingStep.confirm")}
              </button>
            </div>
          </div>
        )}
      </ColumnMapper>
    </div>
  );
}
