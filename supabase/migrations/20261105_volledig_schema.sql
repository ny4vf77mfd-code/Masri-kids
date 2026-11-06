-- Masri Kids: volledige databasestructuur (alleen structuur, geen gegevens).
-- Uitgelezen uit het live project udiqtseewsifcmxsrwtu op 2026-11-05.
-- Het live project heeft deze structuur al; dit bestand is bedoeld om een
-- NIEUW, leeg project (de testomgeving) precies hetzelfde in te richten.
-- Vervangt de onvolledige beschrijving in 20261103_init_masri_kids.sql.

-- ─── Tabellen ────────────────────────────────────────────────────────────
create table if not exists public.players (
  id text primary key,
  family_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists players_family_idx on public.players (family_id);

create table if not exists public.family_settings (
  family_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- Woordaanpassingen door de beheerder (gelden voor alle gezinnen)
create table if not exists public.content (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- AI-taalpartner
create table if not exists public.ai_config (
  id integer primary key default 1 check (id = 1),
  active_adult boolean not null default false,
  active_kids boolean not null default false,
  model_adult text not null default 'claude-sonnet-5-5',
  model_kids text not null default 'claude-sonnet-5-5',
  test_models text[] not null default array['claude-haiku-5-5','claude-sonnet-5-5'],
  family_daily_msgs integer not null default 150,
  monthly_token_limit bigint not null default 3000000,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_usage (
  family_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  count integer not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  per_player jsonb not null default '{}'::jsonb,
  primary key (family_id, day)
);

create table if not exists public.ai_tests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  summary jsonb,
  results jsonb
);
create index if not exists ai_tests_created_by_idx on public.ai_tests (created_by);

create table if not exists public.ai_ratings (
  id bigint generated always as identity primary key,
  test_id bigint not null references public.ai_tests(id) on delete cascade,
  idx integer not null,
  model text not null,
  score integer not null check (score >= 1 and score <= 5),
  note text,
  rated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (test_id, idx)
);
create index if not exists ai_ratings_rated_by_idx on public.ai_ratings (rated_by);

create table if not exists public.ai_speech_tests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  kind text not null check (kind = any (array['stt','tts'])),
  device text,
  results jsonb
);
create index if not exists ai_speech_tests_created_by_idx on public.ai_speech_tests (created_by);

-- ─── Hulpfunctie ─────────────────────────────────────────────────────────
create or replace function public.is_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$function$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- ─── Beveiliging (RLS): elk gezin ziet alleen eigen gegevens ─────────────
alter table public.players          enable row level security;
alter table public.family_settings  enable row level security;
alter table public.admins           enable row level security;
alter table public.content          enable row level security;
alter table public.ai_config        enable row level security;
alter table public.ai_usage         enable row level security;
alter table public.ai_tests         enable row level security;
alter table public.ai_ratings       enable row level security;
alter table public.ai_speech_tests  enable row level security;

create policy "gezin leest eigen spelers" on public.players for select to authenticated
  using (family_id = (select auth.uid()));
create policy "gezin maakt eigen spelers" on public.players for insert to authenticated
  with check (family_id = (select auth.uid()));
create policy "gezin wijzigt eigen spelers" on public.players for update to authenticated
  using (family_id = (select auth.uid())) with check (family_id = (select auth.uid()));
create policy "gezin verwijdert eigen spelers" on public.players for delete to authenticated
  using (family_id = (select auth.uid()));

create policy "gezin leest eigen instellingen" on public.family_settings for select to authenticated
  using (family_id = (select auth.uid()));
create policy "gezin maakt eigen instellingen" on public.family_settings for insert to authenticated
  with check (family_id = (select auth.uid()));
create policy "gezin wijzigt eigen instellingen" on public.family_settings for update to authenticated
  using (family_id = (select auth.uid())) with check (family_id = (select auth.uid()));

create policy "beheerder ziet zichzelf" on public.admins for select to authenticated
  using (user_id = (select auth.uid()));

create policy "iedereen ingelogd leest inhoud" on public.content for select to authenticated
  using (true);
create policy "beheerder voegt inhoud toe" on public.content for insert to authenticated
  with check (exists (select 1 from public.admins a where a.user_id = (select auth.uid())));
create policy "beheerder wijzigt inhoud" on public.content for update to authenticated
  using (exists (select 1 from public.admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admins a where a.user_id = (select auth.uid())));
create policy "beheerder verwijdert inhoud" on public.content for delete to authenticated
  using (exists (select 1 from public.admins a where a.user_id = (select auth.uid())));

create policy "iedereen ingelogd leest config" on public.ai_config for select to authenticated
  using (true);
create policy "beheerders wijzigen config" on public.ai_config for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "eigen gebruik lezen" on public.ai_usage for select to authenticated
  using (family_id = (select auth.uid()));

create policy "beheerders lezen tests" on public.ai_tests for select to authenticated
  using (public.is_admin());

create policy "beheerders lezen beoordelingen" on public.ai_ratings for select to authenticated
  using (public.is_admin());
create policy "beheerders beoordelen" on public.ai_ratings for insert to authenticated
  with check (public.is_admin());
create policy "beheerders wijzigen beoordeling" on public.ai_ratings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "beheerders lezen spraaktests" on public.ai_speech_tests for select to authenticated
  using (public.is_admin());
create policy "beheerders slaan spraaktests op" on public.ai_speech_tests for insert to authenticated
  with check (public.is_admin());

-- ─── Opslag (audio en afbeeldingen) ──────────────────────────────────────
-- Privé-bucket 'media': map <uid>/ per gezin, map shared/ leesbaar voor
-- iedereen die is ingelogd en schrijfbaar voor beheerders.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 5242880, array[
  'audio/mp4','audio/x-m4a','audio/m4a','audio/mpeg','audio/wav','audio/x-wav',
  'audio/webm','audio/ogg','audio/aac','video/mp4','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "media lezen" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (
    (storage.foldername(name))[1] = ((select auth.uid()))::text
    or (storage.foldername(name))[1] = 'shared'));
create policy "media toevoegen" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (
    (storage.foldername(name))[1] = ((select auth.uid()))::text
    or ((storage.foldername(name))[1] = 'shared' and public.is_admin())));
create policy "media wijzigen" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (
    (storage.foldername(name))[1] = ((select auth.uid()))::text
    or ((storage.foldername(name))[1] = 'shared' and public.is_admin())))
  with check (bucket_id = 'media' and (
    (storage.foldername(name))[1] = ((select auth.uid()))::text
    or ((storage.foldername(name))[1] = 'shared' and public.is_admin())));
create policy "media verwijderen" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (
    (storage.foldername(name))[1] = ((select auth.uid()))::text
    or ((storage.foldername(name))[1] = 'shared' and public.is_admin())));

-- Niet overgenomen: extensie pg_net (staat in live in het publieke schema,
-- maar wordt door de app niet gebruikt; Supabase-advies is die daar weg te halen).
