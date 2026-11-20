-- Steuerbetrag laut Beleg je Belegposition.
--
-- Lieferanten duerfen die Steuer je Position runden (§ 14 UStG). Die Summe
-- weicht dann von der Rueckrechnung aus dem Bruttobetrag ab. Fuer den
-- Vorsteuerabzug zaehlt der ausgewiesene Betrag, deshalb muss er speicherbar
-- sein. NULL = wie bisher aus total und vatRate ableiten.

ALTER TABLE "document_line_items" ADD COLUMN "vatAmount" DECIMAL(10,2);
