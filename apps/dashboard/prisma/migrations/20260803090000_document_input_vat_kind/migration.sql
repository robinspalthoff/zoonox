-- Steuerliche Behandlung von Eingangsleistungen mit umgekehrter Steuerschuld.
--
-- Ohne dieses Feld landet eine Reverse-Charge-Rechnung (z.B. Software- oder
-- Werbeleistung aus dem EU-Ausland) entweder gar nicht oder faelschlich in
-- Kz 66 der Umsatzsteuer-Voranmeldung. NULL bleibt der Regelfall:
-- inlaendische Rechnung mit ausgewiesener Vorsteuer.

CREATE TYPE "InputVatKind" AS ENUM (
    'REVERSE_CHARGE_EU_SERVICE',
    'REVERSE_CHARGE_OTHER',
    'REVERSE_CHARGE_GRESTG',
    'INTRA_COMMUNITY_ACQUISITION',
    'IMPORT_VAT'
);

ALTER TABLE "documents" ADD COLUMN "inputVatKind" "InputVatKind";
