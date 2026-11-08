# Nowie’s World

Leer Egyptisch Arabisch (Masri) met Nowie de kat. Voor kinderen van 4 tot 9 jaar, en ouders die meespelen.

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

- **Personages.** Kinderen van 7 tot 9 praten met Nowie, volwassenen en tieners met Salma. Voor kinderen van 4 tot 6 staat hij uit, omdat zij nog niet kunnen lezen.
- **Staat standaard UIT.** De beheerder activeert hem per doelgroep in Ouders → Taalpartner. Dat kan pas als alle antwoorden van de dialecttest zijn beoordeeld. Tot die tijd kan alleen de beheerder proefgesprekken voeren.
- **Kinderen.** Een ouder zet de taalpartner per kind aan en kiest een daglimiet (Instellingen). Gesprekken zijn terug te lezen bij Voortgang. Berichten met een e-mailadres, telefoonnummer, adres of link gaan niet naar de AI.
- **Server.** `supabase/functions/ai-chat/` bestaat uit drie bestanden:
  - `index.ts`: toegang, limieten en veiligheid
  - `prompts.ts`: personages, de 20 testsituaties en het antwoordformaat (Arabisch, Franco, Nederlands, correctie)
  - `providers.ts`: de AI-provider. Een andere provider = daar een provider toevoegen + secret `AI_PROVIDER`.
- **Sleutel.** Alleen als Supabase Secret: `ANTHROPIC_API_KEY`.
- **Kosten.** Tabel `ai_config` bevat de modellen, het maandbudget in tokens en het aantal berichten per gezin per dag. `ai_usage` telt berichten en tokens. De inhoud van gesprekken wordt niet op de server bewaard (alleen de gesprekken van kinderen in hun eigen profiel, voor de ouders). Stel ook in de Anthropic Console een maximaal maandbedrag in.
- **Tests.** `ai_tests` (dialecttest), `ai_ratings` (jouw beoordelingen, blind A/B) en `ai_speech_tests` (spraakherkenning en stemmen per apparaat).
