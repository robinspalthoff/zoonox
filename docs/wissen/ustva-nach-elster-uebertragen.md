# Umsatzsteuer-Voranmeldung an ELSTER übermitteln

> **Inhaltsentwurf für den Wissensbereich.** Der Text ist fertig, die
> Screenshots fehlen — siehe die mit `[SCREENSHOT]` markierten Stellen. Diese
> müssen aus einem echten Mein-ELSTER-Zugang aufgenommen werden.
>
> Redaktioneller Hinweis: Dieser Artikel ist bewusst **kein** Feld-für-Feld-
> Ausfüllhilfe. Zoonox hat die Zahlen bereits berechnet; die Anleitung muss nur
> den Weg durch Mein ELSTER zeigen. Wer hier anfängt, jede Kennzahl zu
> erklären, dupliziert die Formularansicht und muss beides doppelt pflegen.
>
> **Aktualisieren, wenn:** das BMF ein neues Vordruckmuster veröffentlicht
> (jährlich, meist im Dezember) oder Mein ELSTER die Oberfläche ändert.
> Stand: Vordruck USt 1 A 2026.

## Bevor es losgeht: der ELSTER-Zugang

Die Voranmeldung muss **authentifiziert** übermittelt werden (§ 18 Absatz 1
Satz 1 UStG in Verbindung mit § 87a Absatz 6 Satz 1 AO). Dafür brauchen Sie ein
Zertifikat von ELSTER.

> ⚠️ **Die Registrierung dauert bis zu zwei Wochen.**
> ELSTER verschickt einen Aktivierungscode per Post. Wer am 8. des Monats
> merkt, dass der Zugang fehlt, kann die Frist nicht mehr halten. Registrieren
> Sie sich, sobald Sie wissen, dass Sie voranmeldepflichtig sind.

1. Auf [elster.de](https://www.elster.de) unter „Benutzerkonto erstellen"
   registrieren. Die kostenlose Variante („Zertifikatsdatei") genügt.
2. Aktivierungs-ID per E-Mail und Aktivierungscode per Post abwarten.
3. Mit beiden Codes die Zertifikatsdatei (`.pfx`) herunterladen.
4. **Datei sichern.** Sie ist Ihr Schlüssel zum Finanzamt. Geht sie verloren,
   müssen Sie den gesamten Registrierungsprozess wiederholen — inklusive der
   zwei Wochen Wartezeit. Bewahren Sie eine Kopie getrennt vom Arbeitsrechner
   auf, zum Beispiel in Ihrem Passwortmanager.

[SCREENSHOT: elster.de Startseite, Schaltfläche „Benutzerkonto erstellen"]

## Wann muss abgegeben werden?

| Situation | Abgaberhythmus |
|---|---|
| Vorjahressteuer über 9.000 € | monatlich |
| Vorjahressteuer 2.000 € bis 9.000 € | vierteljährlich |
| Vorjahressteuer unter 2.000 € | Befreiung möglich, das Finanzamt entscheidet |
| Neugründung | in der Regel monatlich in den ersten beiden Jahren |

Abgabefrist ist jeweils der **10. Tag nach Ablauf des Zeitraums**. Fällt er auf
ein Wochenende oder einen Feiertag, verschiebt er sich auf den nächsten
Werktag.

Mit einer **Dauerfristverlängerung** (§ 46 UStDV) verschiebt sich die Frist um
einen Monat. Wer monatlich abgibt, muss dafür eine Sondervorauszahlung
anmelden. Diesen Antrag stellen Sie separat über den Vordruck USt 1 H — er ist
nicht Teil der Voranmeldung und wird von Zoonox nicht erzeugt.

## Kleinunternehmer

Wenn Sie die Kleinunternehmerregelung nach § 19 UStG anwenden, geben Sie keine
Voranmeldung ab. Zoonox blendet die Formularansicht dann aus und zeigt
stattdessen einen Hinweis.

## Die Übertragung, Schritt für Schritt

Öffnen Sie in Zoonox **Steuern → UStVA → Formularansicht für ELSTER** und
wählen Sie den Zeitraum. Lassen Sie das Fenster geöffnet — Sie arbeiten die
Liste gleich von oben nach unten ab.

### 1. Formular in Mein ELSTER öffnen

In Mein ELSTER: **Formulare & Leistungen → Alle Formulare → Umsatzsteuer →
Umsatzsteuer-Voranmeldung**. Danach das Jahr wählen.

[SCREENSHOT: Formularauswahl mit Jahresauswahl]

### 2. Zeitraum wählen

Monat oder Kalendervierteljahr — passend zu dem Zeitraum, den Sie in Zoonox
eingestellt haben. Prüfen Sie das doppelt: eine Voranmeldung für den falschen
Monat ist der häufigste Fehler und muss anschließend berichtigt werden.

[SCREENSHOT: Auswahl des Voranmeldungszeitraums]

### 3. Stammdaten prüfen

Steuernummer und Anschrift übernimmt Mein ELSTER aus Ihrem Profil. Falls die
Steuernummer fehlt, finden Sie sie auf Ihrem letzten Steuerbescheid.

### 4. Werte übertragen

Jetzt der eigentliche Teil — und er ist kürzer, als er aussieht.

**Mein ELSTER zeigt exakt dasselbe Formular wie Zoonox.** Gleiche
Abschnittsbuchstaben (A bis J), gleiche Zeilennummern, gleiche Kennzahlen. Sie
müssen nichts übersetzen und nichts zuordnen:

- In Zoonox steht `Zeile 13 · Kz 81 · 9.504`
- In Mein ELSTER steht in Abschnitt A, Zeile 13, das Feld mit der Kennzahl 81

Klicken Sie in Zoonox auf das Kopiersymbol rechts neben dem Betrag und fügen
Sie ihn im entsprechenden Feld ein. Der kopierte Wert ist bereits im richtigen
Format: Bemessungsgrundlagen ohne Nachkommastellen, Steuerbeträge mit Komma.

**Zeilen ohne Betrag lassen Sie leer.** Nicht mit einer Null füllen — die
Anleitung zum Vordruck sagt ausdrücklich, dass nicht benötigte Felder frei
bleiben.

Drei Felder befüllt Zoonox bewusst nicht:

| Feld | Warum |
|---|---|
| Kz 39, Zeile 49 | Sondervorauszahlung bei Dauerfristverlängerung — den festgesetzten Betrag kennt nur Ihr Finanzamtsbescheid |
| Kz 87, Zeile 15 | Nullsatz für Photovoltaik (§ 12 Absatz 3 UStG) — betrifft fast niemanden |
| Kz 29 / 26 / 500 | Ankreuzfelder zu Verrechnung, SEPA-Mandat und ergänzenden Angaben — das sind Ihre Entscheidungen |

[SCREENSHOT: Abschnitt A im ELSTER-Formular, Kennzahl 81 hervorgehoben]

### 5. Ergebnis abgleichen

Mein ELSTER rechnet die Zahllast selbst aus. **Vergleichen Sie das Ergebnis in
Kz 83 mit dem Betrag, den Zoonox oben groß anzeigt.** Stimmen beide überein,
haben Sie sich nicht vertippt. Das ist die wirksamste Kontrolle des ganzen
Vorgangs — sie prüft jede einzelne übertragene Zahl auf einmal.

Weichen die Beträge um wenige Cent ab, ist das in Ordnung: ELSTER rechnet die
Steuer aus der auf volle Euro gerundeten Bemessungsgrundlage, Ihre Buchhaltung
summiert die je Beleg gerundeten Beträge. Zoonox weist diese Differenz separat
aus. Weicht mehr als ein Euro ab, haben Sie eine Zahl falsch übertragen.

### 6. Prüfen und absenden

Mein ELSTER bietet vor dem Absenden eine Plausibilitätsprüfung an. Nutzen Sie
sie — sie fängt formale Fehler ab, bevor das Finanzamt sie zurückweist.

Danach absenden und **die Übermittlungsbestätigung als PDF speichern**. Sie ist
Ihr Nachweis, dass und wann Sie fristgerecht übermittelt haben, und unterliegt
der Aufbewahrungspflicht.

[SCREENSHOT: Prüfen-und-Senden-Dialog mit der Schaltfläche „Absenden"]

## Etwas war falsch — was jetzt?

Eine bereits übermittelte Voranmeldung korrigieren Sie, indem Sie dieselbe
Voranmeldung erneut abgeben und in **Zeile 10 die Kennzahl 10 auf „1" setzen**
(„Berichtigte Anmeldung"). Tragen Sie dabei alle Werte erneut ein, nicht nur
die geänderten — die berichtigte Anmeldung ersetzt die ursprüngliche
vollständig.

## Häufige Fragen

**Kann Zoonox die Voranmeldung direkt übermitteln?**
Aktuell nicht. Zoonox bereitet die Zahlen auf, die Übermittlung läuft über
Ihren eigenen ELSTER-Zugang. Der Vorteil: Sie behalten die Kontrolle darüber,
was das Finanzamt bekommt, und sehen jede Zahl vor dem Absenden.

**Warum weicht meine Zahllast um ein paar Cent von der Buchhaltung ab?**
Siehe Schritt 5 — das ist eine Rundungsdifferenz und normal.

**Was ist mit der Zusammenfassenden Meldung?**
Wer innergemeinschaftliche Lieferungen (Kz 41) oder sonstige Leistungen an
EU-Unternehmer (Kz 21) ausführt, muss zusätzlich eine Zusammenfassende Meldung
an das Bundeszentralamt für Steuern übermitteln. Das ist ein eigenes Verfahren
und nicht Teil der Voranmeldung.

---

*Dieser Artikel ersetzt keine steuerliche Beratung. Bei Zweifeln zu einzelnen
Kennzahlen wenden Sie sich an Ihren Steuerberater.*
