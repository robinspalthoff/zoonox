-- Umsatzsteuer im Kassenbuch.
--
-- Bisher wurden Kassenvorgaenge ohne Steueraufteilung gebucht. Bareinnahmen
-- mit Umsatzsteuer fehlten dadurch vollstaendig in der Voranmeldung.
-- NULL = ohne Steuer, wie bisher.

ALTER TABLE "cashbook_entries" ADD COLUMN "vatRate" DECIMAL(5,2);
ALTER TABLE "cashbook_entries" ADD COLUMN "vatAmount" DECIMAL(10,2);
