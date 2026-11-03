-- Al toegepast op Supabase-project udiqtseewsifcmxsrwtu (ter documentatie).
-- Spelers en instellingen per gezin (= ouderaccount), afgeschermd met RLS.
create table public.players (
  id text primary key,
  family_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.family_settings (
  family_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.admins (user_id uuid primary key references auth.users(id) on delete cascade);
-- Policies: elk gezin leest/schrijft alleen rijen met family_id = auth.uid().
-- Storage-bucket 'media' (privé): map <uid>/ per gezin, map shared/ leesbaar voor iedereen
-- die is ingelogd en schrijfbaar voor beheerders (public.admins).
