-- Trennung von "OCR fertig" und "vom Nutzer fertiggestellt".
--
-- Bisher setzte die Texterkennung status = DONE, was auch der Wert fuer
-- "vom Nutzer fertiggestellt" ist. Dadurch galt ein frisch hochgeladener
-- Beleg als abgeschlossen.

ALTER TABLE "documents" ADD COLUMN "ocrCompletedAt" TIMESTAMP(3);

-- Bestandsdaten: Belege mit erkanntem Text hatten die OCR durchlaufen.
-- Als Zeitpunkt nehmen wir updatedAt — genauer ist rueckwirkend nicht
-- feststellbar und fuer die Auswertung reicht "war durch".
UPDATE "documents" SET "ocrCompletedAt" = "updatedAt" WHERE "ocrText" IS NOT NULL;
