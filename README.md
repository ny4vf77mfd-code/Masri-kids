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
