"use client";

/**
 * EditBankAccountDialog
 * ─────────────────────
 * In-place edit for a single bank account, opened from the gear icon in
 * the account-detail header. Keeps the user on /dashboard/bank/<id>
 * instead of bouncing through /dashboard/bank/accounts.
 *
 * Reuses ManualBankForm from bank-accounts-view so the field layout,
 * validation and styling stay in lockstep with the wizard's edit path.
 * Only BANK-type accounts are supported here — CLEARING accounts are
 * managed from the accounts page where the dedicated ClearingForm
 * lives. If the gear is clicked on a CLEARING account we fall back to
 * a link out to the accounts page rather than degrade the dialog.
 */

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { formatIban, isValidIban } from "@/lib/bank-utils";
import { upsertBankAccount } from "../actions";
import { ManualBankForm } from "../accounts/bank-accounts-view";
import { cn } from "@/lib/utils";

export interface EditableBankAccount {
  id: string;
  name: string;
  type: "BANK" | "CLEARING";
  bankName: string | null;
  iban: string | null;
  bic: string | null;
  openingBalance: number;
  bookingAccount: string | null;
  isDefault: boolean;
}

interface Props {
  account: EditableBankAccount;
  onClose: () => void;
  /** Called after a successful save, before the dialog closes. */
  onSaved?: () => void;
}

export function EditBankAccountDialog({ account, onClose, onSaved }: Props) {
  const t = useTranslations("bank.accounts");

  // Local form state, seeded from the account on first render. We don't
  // re-sync from props on every render — the dialog is short-lived and
  // the user is the only thing editing these values while it's open.
  const [name, setName] = useState(account.name);
  const [bankName, setBankName] = useState(account.bankName ?? "");
  const [iban, setIban] = useState(account.iban ? formatIban(account.iban) : "");
  const [bic, setBic] = useState(account.bic ?? "");
  const [openingBalance, setOpeningBalance] = useState(String(account.openingBalance));
  const [bookingAccount, setBookingAccount] = useState(account.bookingAccount ?? "");
  const [isDefault, setIsDefault] = useState(account.isDefault);
  const [ibanError, setIbanError] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    // Match the wizard's client-side IBAN guard so the user gets the
    // same feedback shape in both edit surfaces.
    const cleanedIban = iban.replace(/\s/g, "");
    if (cleanedIban && !isValidIban(cleanedIban)) {
      setIbanError(true);
      return;
    }
    setIbanError(false);

    startTransition(async () => {
      const result = await upsertBankAccount({
        id: account.id,
        type: "BANK",
        name,
        bankName: bankName || null,
        iban: cleanedIban || null,
        bic: bic || null,
        openingBalance: Number(openingBalance) || 0,
        bookingAccount: bookingAccount || null,
        isDefault,
        // Edits always carry the requireBookingAccount intent from the
        // original create flow (CSV-imported accounts must have one to
        // post the journal). Sending true here is safe — the server
        // only enforces it when the field is actually empty.
        requireBookingAccount: true,
      });
      if (result.success) {
        onSaved?.();
        onClose();
      } else {
        setServerError(result.error);
      }
    });
  }

  return (
    <Shell onClose={onClose} title={t("editTitle")}>
      <div className="p-5">
        {/*
          We intentionally do NOT render the dialog for CLEARING accounts;
          the parent should guard against this. If a CLEARING account
          slips through, surface a hard, visible error rather than render
          a half-broken form so the bug doesn't ship silently.
        */}
        {account.type !== "BANK" ? (
          <p className="text-sm text-destructive">
            {t("editClearingUnsupported")}
          </p>
        ) : (
          <>
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
              onSubmit={handleSubmit}
              onCancel={onClose}
            />
            {serverError && (
              <div className="mt-3 px-3 py-2 bg-destructive/10 text-destructive text-xs rounded">
                {serverError}
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────
// Local copy of the small modal shell used elsewhere in the bank module.
// Worth duplicating (vs. a shared util) because each surface tunes width,
// header copy and close behaviour slightly differently.

function Shell({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          "bg-card border border-border rounded-lg w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-sm">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
