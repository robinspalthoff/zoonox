// Typed subset of the Enable Banking API responses we consume.
// Only the fields we actually read are modelled; the API returns more.
// Reference: https://enablebanking.com/docs/api/reference/

/** A bank (ASPSP) available for authorization. */
export interface Aspsp {
  name: string;
  country: string;
  logo?: string;
  psu_types?: Array<"business" | "personal">;
  /** Max consent lifetime in seconds; we clamp our request against this. */
  maximum_consent_validity?: number;
  beta?: boolean;
  sandbox?: boolean;
}

export interface AspspListResponse {
  aspsps: Aspsp[];
}

/** POST /auth request body. */
export interface AuthRequest {
  access: {
    valid_until: string; // RFC3339
    // Omitting balances/transactions requests full access to both.
  };
  aspsp: { name: string; country: string };
  state: string;
  redirect_url: string;
  psu_type: "business" | "personal";
  language?: string;
}

/** POST /auth response — the URL to redirect the PSU to. */
export interface AuthResponse {
  url: string;
  authorization_id?: string;
  psu_id_hash?: string;
}

/** A monetary amount as returned by EB (amount is a decimal string). */
export interface AmountType {
  amount: string;
  currency: string;
}

export interface AccountIdentification {
  iban?: string;
  other?: { identification: string; scheme_name?: string };
}

/** An account made accessible by an authorized session. */
export interface AccountResource {
  uid: string;
  account_id?: AccountIdentification;
  identification_hash?: string;
  name?: string;
  product?: string;
  currency?: string;
  cash_account_type?: string;
  usage?: string;
}

/** POST /sessions response. `accounts` may arrive as full resources or bare
 *  uid strings depending on ASPSP; we normalize both in the mapper. */
export interface SessionResponse {
  session_id: string;
  accounts: Array<AccountResource | string>;
  aspsp?: { name: string; country: string };
  psu_type?: string;
  access?: { valid_until?: string };
  status?: string;
}

export interface Balance {
  name?: string;
  balance_amount: AmountType;
  balance_type?: string; // CLBD, CLAV, ...
}

export interface BalancesResponse {
  balances: Balance[];
}

export interface PartyAccount {
  iban?: string;
}

export interface Transaction {
  entry_reference?: string;
  transaction_amount: AmountType;
  credit_debit_indicator: "CRDT" | "DBIT";
  status?: string; // BOOK, PDNG, ...
  booking_date?: string; // YYYY-MM-DD
  value_date?: string;
  transaction_date?: string;
  remittance_information?: string[];
  debtor?: { name?: string };
  debtor_account?: PartyAccount;
  creditor?: { name?: string };
  creditor_account?: PartyAccount;
}

export interface TransactionsResponse {
  transactions: Transaction[];
  continuation_key?: string;
}
