# Running zoonox locally

Everything runs on one machine. No cloud account is required: document storage
falls back to the local filesystem, OCR falls back to a free vision model, and
email is simply never sent.

## Requirements

- Node.js >= 20, npm >= 10
- Docker (OrbStack or Docker Desktop) — only for PostgreSQL

## 1. Install

```bash
git clone https://github.com/robinspalthoff/zoonox.git
cd zoonox
npm install
```

## 2. Start PostgreSQL

```bash
docker compose -f infra/docker/docker-compose.dev.yml up -d postgres
```

## 3. Configure

```bash
cd apps/dashboard
cp .env.example .env
```

Then edit `.env`. These are the only values that matter for a local run:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/accounting_dev"
AUTH_SECRET="<openssl rand -base64 32>"
AUTH_URL="http://localhost:3001"
NEXT_PUBLIC_APP_URL="http://localhost:3001"

STORAGE_DRIVER=local          # files land in apps/dashboard/uploads/

SEED_ADMIN_EMAIL="you@example.com"
SEED_ADMIN_PASSWORD="<at least 12 characters>"
SEED_ADMIN_FIRST_NAME="Your"
SEED_ADMIN_LAST_NAME="Name"
```

Everything else can stay empty. What you lose by leaving it empty:

| Empty variable | Effect |
|---|---|
| `MISTRAL_API_KEY` | OCR falls back to OpenRouter (`OPENROUTER_API_KEY`, free model). Rasterizes PDFs and reads the first two pages only — fine for single-page receipts. |
| `OPENROUTER_API_KEY` | No OCR at all. Receipts must be filled in by hand. |
| `BREVO_API_KEY` | Invoices and quotes can still be generated and downloaded, but not emailed. |
| `KOSIT_VALIDATOR_URL` | E-invoice XML is generated but not validated before sending. |
| `ENABLEBANKING_*` | No PSD2 bank sync. CSV / MT940 / CAMT.053 import still works. |
| `BACKUP_R2_BUCKET_NAME` | The nightly backup job stays off. |
| `INBOUND_EMAIL_DOMAIN` | The receipts-by-email inbox is hidden. |

Optional KoSIT validator, if you want e-invoices checked before sending:

```bash
docker run -d -p 8081:80 backofficeplus/e-invoice-validator:latest
# then: KOSIT_VALIDATOR_URL=http://localhost:8081
```

## 4. Database

```bash
npm run db:migrate    # apply schema
npm run db:seed       # create the admin user from SEED_ADMIN_*
```

Self-service sign-up is disabled (`ALLOW_SIGNUP`); the seeded admin is the way
in. Two-factor auth is optional and can be enabled later under Settings.

## 5. Run

```bash
npm run dev           # http://localhost:3001
npm run worker        # second terminal — scheduled jobs
```

The worker handles recurring invoices, depreciation runs, quote expiry, bank
sync, cleanup and backups. Without it the app works, but nothing happens on a
schedule.

## Useful commands

| Command | Purpose |
|---|---|
| `npm test` | Unit tests (120) |
| `npm run type-check` | TypeScript, no emit |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | Drop and recreate the database (⚠️ deletes everything) |

## Backups

With `STORAGE_DRIVER=local` your data lives in two places:

- the `accounting_dev` database → `pg_dump`
- `apps/dashboard/uploads/` → the receipt and invoice files

Both are needed. A database dump without the files leaves documents whose
`storagePath` points at nothing.
