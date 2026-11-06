# Afspraken voor Claude in dit project

De eigenaar is geen programmeur. Communiceer in eenvoudig Nederlands, geef maximaal één handmatige stap tegelijk, en rapporteer na elke stap: **Gedaan / Getest / Resultaat / Mijn actie / Volgende stap**. Zeg nooit dat iets getest is als dat niet zo is.

## Werkwijze (altijd)
1. Nooit rechtstreeks committen of pushen naar `main`. Elke push naar `main` gaat direct live (Vercel productie).
2. Elke wijziging: eigen branch (`fix/...`, `feat/...`, `workflow/...`) → zo klein mogelijk → `node tests/check.mjs` en `node tests/omgeving.mjs` draaien → pull request met korte uitleg.
3. Een PR geeft automatisch een Vercel-testversie (Preview). De eigenaar test die en keurt goed; pas daarna samenvoegen naar `main`.
4. Vraag eerst toestemming voor: live zetten (samenvoegen naar `main`), Edge Functions deployen, databasestructuur of policies wijzigen, gegevens verwijderen, git-geschiedenis herschrijven, iets dat geld kost.

## Twee databases: live en test
- **Live:** Supabase-project `udiqtseewsifcmxsrwtu` (organisatie "Nowiewise"). Alleen gebruikt op exact `masri-kids.vercel.app`.
- **Test:** Supabase-project `jiqzpxkrztjnpathtcvl` (`masri-kids-test`, organisatie "Masri Kids Test", ander Supabase-account). Gebruikt door alle testversies en `localhost`. Alleen fictieve gegevens (`…@example.test`).
- De keuze staat in `SB_ENVS` / `SB_LIVE_HOSTS` in `index.html`. Nieuw live domein? Toevoegen in beide én in `tests/omgeving.mjs`.
- Databasewijzigingen: eerst op het testproject (+ `tests/rls_test.sql`), pas daarna, met toestemming, op live. Houd `supabase/migrations/` bij.
- Nooit echte gezinsgegevens, opnames of foto's naar het testproject kopiëren.
- SQL-tests op live alleen alleen-lezen, of binnen een blok dat altijd wordt teruggedraaid.

## Niet veranderen zonder overleg
- Woord-id's (opnames hangen eraan: `shared/audio/<id>`).
- De RLS-policies (gecontroleerd op 2026-11-05: gezinnen zien alleen hun eigen gegevens).
- Branch `beeldbank-pipeline` heeft een losse geschiedenis: nooit samenvoegen met `main`.
- Geen herbouw, geen nieuw framework, geen grote refactor zonder tests.

## Veilig weergeven
Alle tekst uit de database, de AI of van gebruikers gaat door `esc()` voordat het in HTML komt.

## Kinder-AI
Staat uit (`ai_config.active_kids = false`). Niet aanzetten vóór de privacyfilter (ook voor eerdere berichten) is verbeterd en getest.
