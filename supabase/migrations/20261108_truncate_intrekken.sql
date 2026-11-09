-- TRUNCATE intrekken voor app-rollen, nu en voor toekomstige tabellen.
-- TRUNCATE omzeilt de RLS-regels. De app en de Supabase-API gebruiken het niet, dus gasten (anon),
-- ingelogde gebruikers (authenticated) en PUBLIC hebben dit recht niet nodig.
-- Gewone lees-, schrijf- en verwijderrechten en alle RLS-regels blijven ongewijzigd.
-- service_role en postgres houden hun rechten.
--
-- Gelezen op het testproject (8 nov 2026): de migratierol is postgres. Die heeft standaardrechten in schema
-- public die TRUNCATE geven aan anon en authenticated. Globale standaardrechten voor tabellen zijn er niet.
-- Deze migratie trekt alleen de standaardrechten voor schema public in. Een globale intrekking zou toekomstige
-- tabellen in alle schema's raken en doen we dus niet. Een regel met "in schema" kan een globale toekenning
-- niet opheffen; vindt de migratie zo'n toekenning van TRUNCATE aan een app-rol, dan stopt ze en moet dit eerst
-- worden nagekeken.
-- Buiten bereik: standaardrechten van supabase_admin. postgres is daar geen lid van en mag die niet wijzigen.
-- Alle tabellen in public zijn van postgres.
--
-- Alles staat in één blok: stopt er iets, dan wordt alles teruggedraaid.
do $$
declare
  t record;
  proef oid;
begin
  if current_user <> 'postgres' then
    raise exception 'Gestopt: deze migratie is bedoeld voor rol postgres, niet voor %.', current_user;
  end if;

  -- 0. Stoppen als postgres globaal TRUNCATE toekent aan een app-rol
  if exists (
    select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole::oid
      and d.defaclobjtype = 'r'
      and d.defaclnamespace = 0
      and a.privilege_type = 'TRUNCATE'
      and (a.grantee = 0 or a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid))) then
    raise exception 'Gestopt: de globale standaardrechten van postgres geven TRUNCATE aan een app-rol. Eerst nakijken.';
  end if;

  -- 1. Bestaande tabellen in schema public
  revoke truncate on all tables in schema public from anon, authenticated, public;

  -- 2. Toekomstige tabellen van postgres in schema public
  alter default privileges for role postgres in schema public revoke truncate on tables from anon, authenticated, public;

  -- 3a. Controle bestaande tabellen
  for t in select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    if has_table_privilege('anon', t.oid, 'truncate')
       or has_table_privilege('authenticated', t.oid, 'truncate')
       or has_table_privilege('public', t.oid, 'truncate') then
      raise exception 'Gestopt: tabel % heeft nog TRUNCATE voor een app-rol.', t.relname;
    end if;
  end loop;

  -- 3b. Controle standaardrechten in schema public: geen TRUNCATE meer
  if exists (
    select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole::oid
      and d.defaclobjtype = 'r'
      and d.defaclnamespace = 'public'::regnamespace::oid
      and a.privilege_type = 'TRUNCATE'
      and (a.grantee = 0 or a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid))) then
    raise exception 'Gestopt: de standaardrechten van postgres in schema public geven nog TRUNCATE aan een app-rol.';
  end if;

  -- 3c. Proef met een echte nieuwe tabel; wordt meteen weer verwijderd
  create table public.truncate_proef_20261108 (id int);
  proef := 'public.truncate_proef_20261108'::regclass::oid;
  if has_table_privilege('anon', proef, 'truncate')
     or has_table_privilege('authenticated', proef, 'truncate')
     or has_table_privilege('public', proef, 'truncate') then
    raise exception 'Gestopt: een nieuwe tabel krijgt nog TRUNCATE voor een app-rol.';
  end if;
  if not has_table_privilege('authenticated', proef, 'select')
     or not has_table_privilege('service_role', proef, 'truncate') then
    raise exception 'Gestopt: er zijn meer standaardrechten ingetrokken dan de bedoeling was.';
  end if;
  drop table public.truncate_proef_20261108;
end $$;
