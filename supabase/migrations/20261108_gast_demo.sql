-- Proberen zonder account (gast = Postgres-rol anon).
-- Uitgangspunt: een gast krijgt GEEN toegang tot bestaande gegevens. Er komt een aparte, lege plek
-- waar de beheerder bewust materiaal neerzet dat openbaar mag zijn. Alleen dát kan een gast lezen.
--
-- VOORAF, BUITEN DEZE SQL (handeling in het Supabase-dashboard, niet via SQL):
--   Storage → New bucket
--     Name:                 demo
--     Public bucket:        UIT (privé)
--     Restrict file size:   5 MB
--     Allowed MIME types:   audio/mp4, audio/x-m4a, audio/m4a, audio/mpeg, audio/wav, audio/x-wav,
--                           audio/webm, audio/ogg, audio/aac, image/jpeg, image/png, image/webp
--   De bucket moet leeg zijn. Deze SQL maakt of wijzigt de bucket NIET; hij controleert alleen
--   (lezen) of hij bestaat, privé is en leeg is, en stopt anders.
--
-- Wat deze SQL wel doet:
--  1. Opslag: leesregel voor gasten, alleen bucket 'demo', alleen mappen audio/ en pics/.
--     Beheerregels (lezen, toevoegen, wijzigen, verwijderen) alleen voor de beheerder, ook alleen
--     bucket 'demo' + mappen audio/ en pics/. Bestaande opnames in bucket 'media' blijven dicht.
--  2. Lesinhoud: gasten (anon) en PUBLIC verliezen alle directe tabelrechten op public.content (die gaf
--     Supabase standaard; RLS liet tot nu toe 0 rijen zien, nu kan de tabel helemaal niet meer).
--     Gasten lezen alleen via public.demo_content(): alleen woorden op de lijst public.demo_words,
--     alleen de velden ar, ph, nl, pic, tip. Notities (note), verified, new, w en lesson gaan nooit mee.
--  3. Gasten kunnen nergens iets toevoegen, wijzigen of verwijderen.
--
-- Samenspel met bestaande regels (bron: 20261105_volledig_schema.sql; live gelezen op 8 nov 2026):
--  - storage.objects heeft 4 bestaande policies, allemaal "to authenticated" en allemaal met
--    bucket_id = 'media' in elke voorwaarde. Ze geven dus geen toegang tot bucket 'demo'.
--    Stap 0 controleert dit opnieuw, apart voor USING en WITH CHECK, en stopt als een policy
--    niet op het hoogste niveau tot bucket 'media' beperkt is.
--  - Permissieve policies tellen per rol en per actie op (OF). Daarom eist ELKE nieuwe policy
--    bucket_id = 'demo' én map audio/ of pics/.

-- 0. Vooraf controleren (alleen lezen); stopt de migratie als iets niet klopt ----------------
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'demo') then
    raise exception 'Gestopt: maak eerst in het dashboard de privé-bucket demo aan (zie bovenaan).';
  end if;
  if exists (select 1 from storage.buckets where id = 'demo' and public is distinct from false) then
    raise exception 'Gestopt: bucket demo is openbaar. Zet "Public bucket" uit in het dashboard.';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'demo') then
    raise exception 'Gestopt: bucket demo bevat al bestanden. Eerst nakijken.';
  end if;
  -- Geen bestaande storage-policy voor gasten (anon of public).
  if exists (select 1 from pg_policies
             where schemaname = 'storage' and tablename = 'objects'
               and (roles @> array['anon']::name[] or roles @> array['public']::name[])) then
    raise exception 'Gestopt: er bestaat al een storage-policy voor anon/public.';
  end if;
  -- Elke bestaande storage-policy moet zich op het hoogste niveau beperken tot bucket media,
  -- en wel in ELK deel dat telt: USING (welke bestaande rijen) én WITH CHECK (hoe een rij mag worden).
  --   SELECT/DELETE: USING;  INSERT: WITH CHECK;  UPDATE/ALL: USING én WITH CHECK
  --   (staat WITH CHECK bij UPDATE/ALL leeg, dan gebruikt Postgres de USING-voorwaarde; die is dan al gecontroleerd).
  -- "Op het hoogste niveau" = de voorwaarde begint met (bucket_id = 'media') AND ..., zodat een OR er niet omheen kan.
  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects'
      and (
        (p.cmd in ('SELECT', 'DELETE', 'UPDATE', 'ALL')
          and coalesce(p.qual, '') not like '((bucket_id = ''media''::text) AND %')
        or
        (p.cmd = 'INSERT'
          and coalesce(p.with_check, '') not like '((bucket_id = ''media''::text) AND %')
        or
        (p.cmd in ('UPDATE', 'ALL') and p.with_check is not null
          and p.with_check not like '((bucket_id = ''media''::text) AND %')
      )) then
    raise exception 'Gestopt: een bestaande storage-policy is niet in USING én WITH CHECK beperkt tot bucket media.';
  end if;
  -- Bestaande policies mogen alleen voor authenticated gelden.
  if exists (select 1 from pg_policies
             where schemaname = 'storage' and tablename = 'objects'
               and roles <> array['authenticated']::name[]) then
    raise exception 'Gestopt: er is een storage-policy voor een andere rol dan authenticated.';
  end if;
  -- Geen policy voor gasten op public.content.
  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'content'
               and (roles @> array['anon']::name[] or roles @> array['public']::name[])) then
    raise exception 'Gestopt: er bestaat al een policy voor anon/public op public.content.';
  end if;
end $$;

-- 1. Demo-opslag: regels (bucket zelf: zie bovenaan, via dashboard) --------------------------
create policy "demo lezen gast" on storage.objects for select to anon
  using (bucket_id = 'demo' and (storage.foldername(name))[1] in ('audio', 'pics'));
create policy "demo lezen beheerder" on storage.objects for select to authenticated
  using (bucket_id = 'demo' and (storage.foldername(name))[1] in ('audio', 'pics') and public.is_admin());
create policy "demo toevoegen beheerder" on storage.objects for insert to authenticated
  with check (bucket_id = 'demo' and (storage.foldername(name))[1] in ('audio', 'pics') and public.is_admin());
create policy "demo wijzigen beheerder" on storage.objects for update to authenticated
  using      (bucket_id = 'demo' and (storage.foldername(name))[1] in ('audio', 'pics') and public.is_admin())
  with check (bucket_id = 'demo' and (storage.foldername(name))[1] in ('audio', 'pics') and public.is_admin());
create policy "demo verwijderen beheerder" on storage.objects for delete to authenticated
  using (bucket_id = 'demo' and (storage.foldername(name))[1] in ('audio', 'pics') and public.is_admin());

-- 2. Lesinhoud -------------------------------------------------------------------------------
-- 2a. Gasten: geen directe rechten meer op de tabel content (alleen via demo_content()).
revoke all on public.content from anon, public;  -- ook rechten die via PUBLIC (iedereen) zouden lopen

-- 2b. Lijst met openbare woorden, alleen te beheren door de beheerder.
create table public.demo_words (
  id text primary key check (id ~ '^[a-z0-9_]{1,40}$')
);
alter table public.demo_words enable row level security;
-- Supabase geeft nieuwe tabellen standaard alle rechten (ook TRUNCATE, dat RLS omzeilt).
-- Eerst alles weg, dan alleen wat de beheerder nodig heeft; RLS beperkt het tot de beheerder.
revoke all on public.demo_words from anon, authenticated, public;
grant select, insert, delete on public.demo_words to authenticated;
create policy "beheerder leest demo-woorden"      on public.demo_words for select to authenticated using (public.is_admin());
create policy "beheerder voegt demo-woorden toe"  on public.demo_words for insert to authenticated with check (public.is_admin());
create policy "beheerder verwijdert demo-woorden" on public.demo_words for delete to authenticated using (public.is_admin());

-- 2c. Alleen-lezen interface voor gasten: vaste velden, alleen aangewezen woorden.
create or replace function public.demo_content()
returns table (id text, data jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,
         jsonb_strip_nulls(jsonb_build_object(
           'ar',  c.data->'ar',
           'ph',  c.data->'ph',
           'nl',  c.data->'nl',
           'pic', c.data->'pic',
           'tip', c.data->'tip'))
  from public.content c
  join public.demo_words d on d.id = c.id
  where (c.data->>'new') is distinct from 'true';  -- zelf toegevoegde woorden blijven intern
$$;
revoke execute on function public.demo_content() from public;
grant execute on function public.demo_content() to anon, authenticated;

-- 3. Achteraf controleren; stopt (en draait terug) als iets niet klopt ------------------------
do $$
declare pol record;
begin
  if not exists (select 1 from storage.buckets where id = 'demo' and public = false) then
    raise exception 'Gestopt: bucket demo is niet privé.';
  end if;
  -- precies één storage-policy voor gasten, en die is alleen lezen
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and roles @> array['anon']::name[]) <> 1
     or exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and roles @> array['anon']::name[] and cmd <> 'SELECT') then
    raise exception 'Gestopt: gasten hebben niet precies één leesregel op storage.objects.';
  end if;
  -- elke demo-policy: bucket demo + map audio/pics
  for pol in select policyname, coalesce(qual,'') || ' ' || coalesce(with_check,'') as txt
             from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'demo %' loop
    if pol.txt not like '%bucket_id = ''demo''%' or pol.txt not like '%audio%' or pol.txt not like '%pics%' then
      raise exception 'Gestopt: policy % is niet beperkt tot bucket demo en mappen audio/pics.', pol.policyname;
    end if;
  end loop;
  -- gasten: geen enkel direct recht op content en demo_words
  if has_table_privilege('anon', 'public.content', 'select,insert,update,delete,truncate,references,trigger') then
    raise exception 'Gestopt: anon heeft nog directe rechten op public.content.';
  end if;
  if has_table_privilege('public', 'public.content', 'select,insert,update,delete,truncate,references,trigger') then
    raise exception 'Gestopt: PUBLIC (iedereen) heeft nog rechten op public.content.';
  end if;
  if has_table_privilege('anon', 'public.demo_words', 'select,insert,update,delete,truncate,references,trigger') then
    raise exception 'Gestopt: anon heeft rechten op public.demo_words.';
  end if;
  if has_table_privilege('public', 'public.demo_words', 'select,insert,update,delete,truncate,references,trigger') then
    raise exception 'Gestopt: PUBLIC (iedereen) heeft rechten op public.demo_words.';
  end if;
  if has_table_privilege('authenticated', 'public.demo_words', 'update,truncate,references,trigger') then
    raise exception 'Gestopt: authenticated heeft te veel rechten op public.demo_words.';
  end if;
  if has_function_privilege('public', 'public.demo_content()', 'execute') then
    raise exception 'Gestopt: iedereen (public) mag demo_content() uitvoeren.';
  end if;
end $$;
