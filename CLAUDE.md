# Afspraken voor Claude in dit project

De eigenaar is geen programmeur. Communiceer in eenvoudig Nederlands, geef maximaal één handmatige stap tegelijk, en rapporteer na elke stap: **Gedaan / Getest / Resultaat / Mijn actie / Volgende stap**. Zeg nooit dat iets getest is als dat niet zo is.

## Werkwijze (altijd)
1. Nooit rechtstreeks committen of pushen naar `main`. Elke push naar `main` gaat direct live (Vercel productie).
2. Elke wijziging: eigen branch (`fix/...`, `feat/...`, `workflow/...`) → zo klein mogelijk → `node tests/check.mjs` draaien → pull request met korte uitleg.
3. Een PR geeft automatisch een Vercel-testversie (Preview). De eigenaar test die en keurt goed; pas daarna samenvoegen naar `main`.
4. Vraag eerst toestemming voor: live zetten (samenvoegen naar `main`), Edge Functions deployen, databasestructuur of policies wijzigen, gegevens verwijderen, git-geschiedenis herschrijven, iets dat geld kost.

## Let op: testversies gebruiken de échte database
Preview-versies praten met hetzelfde Supabase-project als de live app (`udiqtseewsifcmxsrwtu`).
- Test alleen met testaccounts, nooit met het beheerdersaccount van de eigenaar.
- Wijzig in een testversie geen woorden, beelden of audio in Ouders → Woorden/Audio: dat geldt meteen voor alle gezinnen.
- Database-tests via SQL alleen binnen een transactie die wordt teruggedraaid (`rollback`).

## Niet veranderen zonder overleg
- Woord-id's (opnames hangen eraan: `shared/audio/<id>`).
- De RLS-policies (gecontroleerd op 2026-11-05: gezinnen zien alleen hun eigen gegevens).
- Branch `beeldbank-pipeline` heeft een losse geschiedenis: nooit samenvoegen met `main`.
- Geen herbouw, geen nieuw framework, geen grote refactor zonder tests.

## Veilig weergeven
Alle tekst uit de database, de AI of van gebruikers gaat door `esc()` voordat het in HTML komt.

## Kinder-AI
Staat uit (`ai_config.active_kids = false`). Niet aanzetten vóór de privacyfilter (ook voor eerdere berichten) is verbeterd en getest.
