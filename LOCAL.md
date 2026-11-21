# Spickzettel — zoonox lokal starten

Drei Befehle. Ausführliche Fassung: [docs/local-setup.md](docs/local-setup.md).

### 1. Datenbank (einmal pro Rechnerneustart)

```bash
docker start lenius-accounting-dev
```

### 2. App

```bash
cd apps/dashboard && npm run dev
```

→ http://localhost:3001

### 3. Hintergrundjobs (zweites Terminal, optional)

```bash
cd apps/dashboard && npm run worker
```

Ohne den Worker läuft die App, aber Abschreibungen, wiederkehrende Rechnungen
und Angebotsabläufe passieren nicht von selbst.

---

## Wenn etwas klemmt

| Problem | Befehl |
|---|---|
| Datenbank antwortet nicht | `docker ps` — läuft `lenius-accounting-dev`? |
| Schema veraltet nach `git pull` | `cd apps/dashboard && npm run db:migrate` |
| In die Daten schauen | `cd apps/dashboard && npm run db:studio` |
| Alles auf Anfang (⚠️ löscht alles) | `cd apps/dashboard && npm run db:reset` |
| Tests | `cd apps/dashboard && npm test` |

## Anmeldung

Es gibt noch keinen Benutzer — `ALLOW_SIGNUP=true` ist gesetzt, du legst dich
unter http://localhost:3001/de/auth/signup selbst an (inklusive 2FA).

## Sichern

Zwei Dinge gehören zusammen, ein Dump allein reicht nicht:

```bash
docker exec lenius-accounting-dev pg_dump -U postgres accounting_dev > ~/zoonox-backup.sql
cp -r apps/dashboard/uploads ~/zoonox-uploads-backup
```
