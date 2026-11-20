# Deployment (historisch)

> **Archiviert.** Der gehostete Betrieb wurde im November 2026 eingestellt.
> Dieses Dokument beschreibt, wie zoonox in Produktion lief — es ist als
> technische Referenz erhalten, nicht als Anleitung für einen Neuaufbau.
> Für den lokalen Betrieb siehe [`local-setup.md`](./local-setup.md).

## Infrastruktur

- **Server:** Hetzner Cloud (FSN1 — Deutschland)
- **Deployment:** Coolify (self-hosted)
- **SSL:** Let's Encrypt via Traefik (automatisch)
- **DB:** PostgreSQL (Docker)

---

## Selbst hosten

1. Docker + Docker Compose auf dem Server installieren
2. `infra/docker/docker-compose.yml` kopieren
3. `.env.example` → `.env` befüllen
4. Starten:
   ```bash
   docker compose up -d
   ```
5. Admin-Konto über `npm run db:seed` anlegen (`SEED_ADMIN_*`)

---

## Environment Variables (Produktion)

Alle Variablen aus `.env.example` müssen gesetzt sein.
Besonders kritisch:

| Variable | Beschreibung |
|----------|-------------|
| `AUTH_SECRET` | `openssl rand -base64 32` — nie wiederverwenden |
| `DATABASE_URL` | Verbindung zur PostgreSQL-Instanz |
| `AUTH_URL` | Öffentliche URL der App (z.B. `https://app.example.com`) |

---

## R2 Object Storage — GoBD-Härtung

Belege und versendete Rechnungs-PDFs müssen nach **§147 AO / GoBD** 10 Jahre
unveränderbar aufbewahrt werden. Das wird über **Cloudflare R2 Object Lock**
durchgesetzt. Object Lock kann **nicht** von der App aktiviert werden — es ist
eine einmalige Bucket-Konfiguration.

### Object Lock am Bucket aktivieren (einmalig, Pflicht)

1. Cloudflare Dashboard → R2 → Bucket `zoonox-documents` → **Settings**
2. **Object Lock** auf **Enabled** stellen (der Toggle / die Aktivierung).
3. **Keine** bucket-weite Default-Retention-Regel anlegen. Der Dialog
   „Rule Name / Rule scope / Retention period“ erzeugt eine *Default-Regel*,
   die **jedes** neue Objekt lockt — also auch Draft-/PENDING-Uploads und
   Fehl-Uploads. Das widerspricht unserem Modell („nur finalisierte
   Records“) und würde den Orphan-Cleanup blockieren. Ein Prefix-Scope hilft
   nicht, weil die `tenantId` mitten im Key steht. Den Rule-Dialog also
   überspringen/abbrechen — die App setzt die Retention **pro Objekt**
   selbst, sobald ein Record finalisiert wird.
4. Ohne aktivierten Object Lock schlägt das Setzen der Retention fehl (im
   Code als `[invoice] PDF archive…` / `[documents] Object Lock failed…`
   geloggt) — der Geschäftsvorfall (Versand, Buchung) läuft trotzdem durch.

> **Kurz:** Primär-Bucket → Object Lock *aktivieren*, **keine** Default-Regel.
> Sekundär-/Backup-Bucket → Object Lock + Default-Regel (siehe unten).

Die App setzt die Retention dann automatisch pro Objekt:

| Objekt | Wann gelockt | Modus | Frist |
|--------|--------------|-------|-------|
| Rechnungs-PDF (`invoices/<id>.pdf`) | bei Finalisierung — E-Mail-Versand **oder** „als versendet markieren“ **oder** erstattete Gutschrift | COMPLIANCE | 31.12. des Jahres + 10 |
| Beleg-Datei (`documents/…`) | wenn Document auf DONE/PAID gebucht wird | COMPLIANCE | 31.12. des Jahres + 10 |

`COMPLIANCE` bedeutet: bis zum Ablaufdatum kann **niemand** — auch nicht der
Account-Owner — das Objekt löschen oder überschreiben. Uploads im Status
PENDING/DRAFT/FAILED werden bewusst **nicht** gelockt, damit Fehl-Uploads noch
entfernbar sind.

Re-Sends einer Rechnung verwenden das **archivierte** PDF unverändert weiter
(nie neu gerendert) — so bleibt „versendetes PDF == archiviertes PDF“.

### Belege löschen (Soft-Delete)

Das Löschen eines Belegs hängt davon ab, ob er bereits **gebucht** ist:

- **Ungebucht** (PENDING/DRAFT/FAILED) — keine Belegfunktion, keine
  Aufbewahrungspflicht: echtes Hard-Delete, Datensatz **und** R2-Objekt weg.
- **Gebucht** (DONE/PAID) — §147-AO-aufbewahrungspflichtig: „Löschen“ ist ein
  **Soft-Delete**. Die Journalbuchungen werden storniert, der Beleg verschwindet
  aus allen Listen (`deletedAt` gesetzt) — Datensatz und Object-Lock-geschützte
  Datei bleiben aber 10 Jahre erhalten. Verknüpfte Banktransaktionen werden
  wieder auf „nicht zugeordnet“ gesetzt.

Jede Löschung (hard wie soft) wird als `DOCUMENT_DELETED` im Audit-Log
protokolliert. Ein Beleg, der Quellbeleg eines Anlageguts ist, kann nicht
gelöscht werden, solange das Anlagegut existiert.

### Worker-Jobs

Der Worker ist ein eigener Long-running-Prozess (pg-boss auf Postgres). Im
Produktions-Image wird er beim Build zu `apps/dashboard/dist/worker.cjs`
gebündelt und über das gemeinsame `entrypoint.sh` per **`ROLE`-Env** gestartet:

| Deployment | Konfiguration |
|------------|---------------|
| `docker-compose` (Self-Hosting) | Der `worker`-Service setzt `ROLE=worker` — läuft automatisch mit. |
| **Coolify (ein Dockerfile-Deploy)** | Entweder eine **zweite** Ressource aus demselben Repo/Dockerfile mit `ROLE=worker` (empfohlen: eigener Neustart/Skalierung), **oder** an der bestehenden App `RUN_WORKER_INLINE=true` setzen (Worker läuft im selben Container mit). Ohne eines von beidem läuft **kein** Worker. |

> Migrationen laufen nur in der `web`-Rolle. Ein `ROLE=worker`-Container
> migriert **nicht** — sonst würden zwei Container gleichzeitig migrieren.

Der Worker fährt zusätzlich zu den Recurring-/AfA-Ticks (und dem Enable-Banking-
Consent-/Sync-Tick) zwei Storage-Jobs:

| Job | Cron (Default) | Zweck |
|-----|----------------|-------|
| `documents-orphan-cleanup` | `0 3 * * *` | Räumt verwaiste PENDING/FAILED-Uploads (älter als `DOCUMENT_ORPHAN_TTL_DAYS`, nirgends verknüpft). |
| `r2-cross-region-backup` | `0 4 * * *` | Spiegelt alle Objekte in einen Sekundär-Bucket. No-op solange `BACKUP_R2_*` leer ist. |

Manueller Backup-Lauf: `npm run storage:backup`.

### Cross-Region-Backup einrichten (empfohlen vor Go-Live)

1. Zweiten R2-Bucket anlegen — idealerweise in **anderem Cloudflare-Account**
   bzw. anderer Region (Disaster Recovery).
2. Auf dem Sekundär-Bucket ebenfalls **Object Lock** mit einer
   **Default-Retention-Regel** aktivieren — gespiegelte Objekte erben die
   Unveränderbarkeit dann automatisch.
3. R2-API-Token für den Sekundär-Bucket erzeugen und `BACKUP_R2_*` in der
   Umgebung setzen (siehe `.env`). Ab dann läuft der Backup-Job nächtlich.

### Zusätzliche Environment Variables

| Variable | Pflicht | Beschreibung |
|----------|---------|--------------|
| `DOCUMENT_ORPHAN_TTL_DAYS` | nein (Default 30) | Alter, ab dem verwaiste Uploads geräumt werden |
| `BACKUP_R2_ACCOUNT_ID` | nur für Backup | Cloudflare-Account-ID des Sekundär-Buckets |
| `BACKUP_R2_ACCESS_KEY_ID` | nur für Backup | Access Key des Sekundär-Tokens |
| `BACKUP_R2_SECRET_ACCESS_KEY` | nur für Backup | Secret des Sekundär-Tokens |
| `BACKUP_R2_BUCKET_NAME` | nur für Backup | Name des Sekundär-Buckets |
| `BACKUP_R2_ENDPOINT` | nein | Überschreibt die abgeleitete Endpoint-URL |
| `WORKER_CLEANUP_CRON` / `WORKER_BACKUP_CRON` | nein | Cron-Overrides für die Storage-Jobs |

---

## Subdomain-Setup (app.example.com)

1. CNAME `app.example.com` → Hetzner-Server-IP
2. In Coolify: Domain im Projekt eintragen
3. SSL-Zertifikat wird automatisch ausgestellt

---

## Updates einspielen

```bash
# In Coolify: "Redeploy" Button
# Oder via GitHub Actions (deploy.yml) bei Push auf main
```

Migrationen laufen bei jedem Deploy automatisch über `entrypoint.sh`.
