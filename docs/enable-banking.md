# Enable Banking (PSD2) — Ops & Go-Live Runbook

> **Archived.** The zoonox Enable Banking application was deregistered in
> November 2026. The integration code is intact; anyone running this needs to
> register their own application and key pair. Kept as a reference for how the
> JWT-signed PSD2 flow was wired up.

Read-only open-banking connection (accounts, balances, transactions) via
[Enable Banking](https://enablebanking.com). Payment initiation (PIS) is out of
scope. This document is the operational reference for secrets, environment
configuration, key rotation and the sandbox → production switch.

Code lives in `apps/dashboard/src/lib/enable-banking/` (client, JWT, sync,
tick), the connect UI in `bank/accounts/`, and the callback at
`app/api/banking/callback/route.ts`.

## How auth works

Every API request is authenticated with a short-lived **RS256 JWT** we sign
ourselves with the application's private key (no OAuth token endpoint). Enable
Banking validates it against the public key registered for the application; the
JWT `kid` is the application id. See `lib/enable-banking/jwt.ts`.

The user-facing flow: `POST /auth` → redirect user to their bank → bank
redirects back to `/api/banking/callback?code&state` → `POST /sessions` →
we link accounts + import booked transactions.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ENABLEBANKING_APP_ID` | yes | – | Application id (JWT `kid`). Different per environment. |
| `ENABLEBANKING_ENV` | no | `sandbox` | `sandbox` or `production`. UI hint only. |
| `ENABLEBANKING_PRIVATE_KEY_PATH` | no | `./secrets/enablebanking-private-key.pem` | PKCS#8 PEM. Must pair with the app's registered public key. |
| `ENABLEBANKING_API_URL` | no | `https://api.enablebanking.com` | Same host for sandbox & prod. |
| `ENABLEBANKING_CONSENT_DAYS` | no | `90` | Requested consent validity; clamped to the ASPSP max. |
| `NEXT_PUBLIC_APP_URL` | yes | – | Used to build the redirect URL `<app>/api/banking/callback`. |
| `WORKER_BANK_SYNC_CRON` | no | `0 */6 * * *` | Background sync cadence (worker). |

## Secret management (private key)

The private key is **never** committed and **never** baked into the Docker
image. `secrets/` is gitignored.

- **Local dev:** `apps/dashboard/secrets/enablebanking-private-key.pem`.
- **Production:** mount the key as a runtime secret and point
  `ENABLEBANKING_PRIVATE_KEY_PATH` at the mount path. Do **not** pass the key
  via a plain env var or COPY it in the Dockerfile.
  - Docker/Compose: `secrets:` block → mounted at `/run/secrets/...`.
  - K8s: `Secret` mounted as a file via `volumeMounts`.
- Use a **separate key pair for production** (never reuse the sandbox key).

## Key rotation

1. Generate a new key pair (PKCS#8): `openssl genpkey -algorithm RSA -out new.pem -pkeyopt rsa_keygen_bits:2048`.
2. Upload the **public** key to the Enable Banking control panel for the app.
3. Deploy the new **private** key to the secret store and update
   `ENABLEBANKING_PRIVATE_KEY_PATH` (or replace the file in place).
4. Restart the app/worker (the key + signed JWT are process-cached; a restart
   clears them — or call `resetJwtCache()` if invoked in-process).
5. Once traffic is confirmed healthy on the new key, remove the old public key
   in the control panel.

## Sandbox → Production go-live checklist

1. **Enable Banking control panel**
   - Create a **production** application (separate from sandbox).
   - Upload the production public key → note the new `APP_ID`.
   - Register the production redirect URL: `https://<domain>/api/banking/callback` (exact match).
   - Confirm the **plan** covers production and the **AIS licence model** (you
     use EB as the regulated AISP under their ToS — confirm in the contract
     that no own BaFin licence is needed for read-only AIS).
   - Fill company/KYB details, app description + logo (shown on the consent screen).
2. **App configuration**
   - Set `ENABLEBANKING_ENV=production`, `ENABLEBANKING_APP_ID=<prod>`,
     `ENABLEBANKING_PRIVATE_KEY_PATH=<prod key mount>`, `NEXT_PUBLIC_APP_URL=<prod url>`.
   - Deploy the prod private key as a mounted secret.
3. **Verify** with one real (low-risk) account, `psu_type=personal`, real SCA.
4. **Legal:** privacy policy (PSD2 consent, data flows, retention/deletion) and
   a DPA with Enable Banking. (Tracked separately — task #21.)

No application code changes are required for the switch — it is env-only.

## Background sync & lifecycle

The long-running worker (`scripts/worker.ts`, queue `enable-banking-sync`,
cron `0 */6 * * *`) does three things platform-wide:

1. Expire consents whose `validUntil` has passed (`ACTIVE → EXPIRED`).
2. Incrementally re-sync active connections (new **booked** transactions since
   `lastSyncedAt`, with a small overlap window; dedup by `externalId`).
3. Delete abandoned `PENDING` connections after 1h.

Users can also trigger a per-connection **"Sync now"** and, when a consent
expires, **reconnect** (re-authorises the same connection row). Auto-matching
of imported transactions runs on the **user-initiated connect** only; the
background resync leaves new items `UNMATCHED` (consistent with CSV import).

Only **booked** transactions are imported; pending (PDNG) items are skipped to
avoid duplicates when they later book with a changed amount/date/id.

## Data protection & retention (DSGVO ↔ GoBD)

- **Consent record:** each `BankConnection` stores the ASPSP, PSU type,
  `authorizedAt`, requested validity (`validUntil`) and the initiating user
  (`createdBy`) as proof of lawful processing. Surfaced to the user via the
  "Consent details" panel in the connection list.
- **Scope:** strictly read-only (accounts, balances, transactions). No payment
  initiation.
- **Disconnect:** revokes the session at Enable Banking and unlinks accounts,
  but **keeps already-imported transactions** — once posted they are accounting
  records under **GoBD** (6–10 year retention), so they must not be deleted on a
  simple disconnect. The `REVOKED` connection row is kept as consent proof.
- **Erasure:** full deletion of bank data happens only on complete tenant
  offboarding (the `Tenant → BankConnection`/`BankAccount` relations cascade).
- **TODO (Robin / legal):** privacy-policy section covering PSD2 consent, the
  data flow through Enable Banking (the AISP), retention periods and the lawful
  basis; plus a DPA with Enable Banking.

## Known follow-ups (not yet implemented)

Balances display (#18), payments export (#22), automated tests (#24).
