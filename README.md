# Masri Kids

Leer Egyptisch Arabisch (Masri) met Mishmish de kat. Voor kinderen van 4 tot 9 jaar, en ouders die meespelen.

- **Alles in één bestand:** `index.html`. Woorden, zinnen, werelden en stickers staan bovenaan in het script.
- **Accounts en opslag:** Supabase (inloggen voor ouders, spelers per gezin, opnames en foto's).
- **Hosting:** Vercel. Elke push naar `main` zet automatisch een nieuwe versie online.

## Inhoud aanpassen
- **In de app (aanbevolen):** Ouders → *Woorden*. Als beheerder pas je Arabisch, uitspraak, vertaling en plaatje aan, vink je woorden af als gecontroleerd, of voeg je nieuwe woorden toe. Dat wordt bewaard in Supabase (tabel `content`) en geldt voor alle gezinnen.
- **In de code:** `WORDS`, `SENTENCES`, `WORLDS`, `DLINES`/`DIALOGS` (gesprekjes) en `STICKERS` bovenaan het script in `index.html`.
- **Ids nooit veranderen:** opnames zijn gekoppeld aan het id van een woord (`shared/audio/<id>`). Meisjesvormen hebben `<id>_f`.
- Velden: `g:'self'` = vorm hangt af van wie spreekt, `g:'you'` = van wie je aanspreekt, `fem:{ar,ph}` = vrouwelijke vorm, `check:'…'` = twijfel die nog gecontroleerd moet worden.

## Volwassenen en tieners

Bij een nieuw profiel kies je: Kind 4–6, Kind 7–9, Tiener of Volwassene. Tieners en volwassenen krijgen de volwassen leeromgeving.
Bestaande profielen blijven automatisch in de kinderomgeving. In Ouders → Instellingen kun je de leeromgeving wisselen; de voortgang van beide blijft bewaard.

- Leerprogramma: `ADULT_LEVELS` en `ADULT_MODS` (modules A1–D4) in `index.html`. Een module gebruikt bestaande woord-id's waar dat kan.
- Nieuwe woorden en zinnen voor volwassenen: `A_ITEMS` (id's beginnen met `a_`).
- Gesprekssituaties: `SC_LINES` (id's `sc_`) en `SCENARIOS` (S1–S8).
- Grammatica-uitleg: `GRAMMAR`.
- Opnames gaan via dezelfde opnamestudio (Ouders → Audio), met eigen tabbladen per module en situatie.
- Zelf-opnames bij "Uitspraak oefenen" blijven op het apparaat en worden niet opgeslagen.

## Schrijfwijze van de uitspraak

Alle uitspraak (`ph`) gaat door één functie: `translit(ph, ar)` in `index.html`. Die wordt gebruikt bij het laden van de woordenlijsten, bij woorden uit de woordeditor en bij nieuwe woorden.

- Ieder woord begint met een hoofdletter, ook na een koppelteken: `Saba7 El-Kheer`.
- `3` = ع, `7` = ح, `Kh` = خ, `Sh` = ش, `Gh` = غ, `'` = stopje (ء of ق), `y` = j-klank.
- Lange klinkers: `ee` = lange i (ي), `oo` = lange oe (و). `ee` gebruik je ook voor de ee-klank (`Feen`, `Beet`).
- Typ je oude spelling in (sj, ch, oe, j, aa), dan zet de app die automatisch om.
- De 3 en de 7 komen uit het Arabische schrift ernaast. Klopt het aantal niet, dan blijft het teken staan.
- Vaste uitzonderingen staan in `TL_MANUAL`, bijvoorbeeld `Ma3a Salama`.

## AI-taalpartner

- Kinderen van 7 tot 9 praten met Mishmish, volwassenen en tieners met Salma. Voor kinderen van 4 tot 6 staat hij uit: die kunnen nog niet lezen, en gesproken antwoorden zijn er nog niet.
- Server: `supabase/functions/ai-chat/index.ts`, als Edge Function `ai-chat`. De API-sleutel staat alleen daar, als secret `ANTHROPIC_API_KEY`.
- Personage, niveau en veiligheidsregels bepaalt de server op basis van het profiel in de database. Bij kinderen worden berichten met persoonlijke gegevens (e-mail, telefoonnummer, adres, links) niet naar de AI gestuurd.
- Instellingen (secrets, allemaal optioneel):
  - `AI_MODEL_ADULT`, `AI_MODEL_KIDS` (standaard `claude-sonnet-5-5`)
  - `AI_DAILY_LIMIT`: berichten per gezin per dag (standaard 150)
  - `AI_TEST_MODELS`
- Tabellen:
  - `ai_usage`: telt alleen het aantal berichten per gezin per dag. De inhoud van gesprekken wordt niet op de server bewaard.
  - `ai_tests`: uitslagen van de dialecttest.
- Dialecttest: Ouders → Taalpartner → Start de dialecttest (alleen voor de beheerder).
- Spraak: inspreken loopt via de spraakherkenning van de browser (`ar-EG`). De knop verschijnt alleen als de browser dat kan. Gesproken AI-antwoorden kunnen later worden aangesloten in `aiSpeak()`.
