-- Beveiligingstest (RLS en tabelrechten op de DATABASE) voor Nowie’s World.
-- Vereist: migratie 20261108_gast_demo.sql.
-- Test drie rollen: een onbekend ingelogd gezin, de beheerder, en een gast (niet ingelogd).
-- Deze test schrijft NIETS in de opslag: het storage-schema behandelen we als alleen-lezen.
-- Uploaden, lezen, verplaatsen en kopiëren van bestanden test tests/storage_api_test.mjs via de Storage-API.
-- Voor opslag staan hier alleen leesbare controles (tellen en has_table_privilege).
--
-- VEILIG: het hele blok eindigt ALTIJD met een foutmelding, waardoor de
-- database alles terugdraait. Er blijft dus nooit iets veranderd achter.
-- De uitslag staat in die foutmelding: "RLS-TEST GESLAAGD" of "RLS-TEST MISLUKT: <wat er mis is>".
do $$
declare
  fout text := '';
  n int;
  ander uuid;
  beheerder uuid;
begin
  select family_id into ander from public.players limit 1;   -- kan leeg zijn in een nieuw project
  select user_id into beheerder from public.admins limit 1;  -- nodig voor de beheerdertest

  -- testgegevens (worden aan het eind teruggedraaid)
  insert into public.content(id, data) values
    ('rlstest_demo',   '{"ar":"x","ph":"x","nl":"x","note":"GEHEIM","verified":true}'),
    ('rlstest_intern', '{"ar":"y","ph":"y","nl":"y","note":"GEHEIM"}');
  insert into public.demo_words(id) values ('rlstest_demo');

  -- opslag, alleen lezen: TRUNCATE omzeilt RLS en mag voor geen enkele app-rol op storage.objects
  if has_table_privilege('anon', 'storage.objects', 'truncate') then fout := fout || ' anon_mag_opslag_legen'; end if;
  if has_table_privilege('authenticated', 'storage.objects', 'truncate') then fout := fout || ' gezin_mag_opslag_legen'; end if;
  if has_table_privilege('public', 'storage.objects', 'truncate') then fout := fout || ' public_mag_opslag_legen'; end if;

  ---------------------------------------------------------------------------------------------
  -- A. ONBEKEND INGELOGD GEZIN
  ---------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
  set local role authenticated;

  -- lezen: een vreemd gezin mag niets van anderen zien
  select count(*) into n from public.players;          if n > 0 then fout := fout || ' spelers_zichtbaar'; end if;
  select count(*) into n from public.family_settings;  if n > 0 then fout := fout || ' instellingen_zichtbaar'; end if;
  select count(*) into n from public.ai_usage;         if n > 0 then fout := fout || ' ai_gebruik_zichtbaar'; end if;
  select count(*) into n from public.admins;           if n > 0 then fout := fout || ' beheerders_zichtbaar'; end if;
  select count(*) into n from public.ai_tests;         if n > 0 then fout := fout || ' ai_tests_zichtbaar'; end if;
  select count(*) into n from storage.objects
    where bucket_id = 'media' and (storage.foldername(name))[1] <> 'shared';
  if n > 0 then fout := fout || ' gezinsmedia_zichtbaar'; end if;
  if public.is_admin() then fout := fout || ' is_beheerder'; end if;

  -- wijzigen: mag niets raken
  update public.players set data = data;   get diagnostics n = row_count; if n > 0 then fout := fout || ' spelers_gewijzigd'; end if;
  update public.content set data = data;   get diagnostics n = row_count; if n > 0 then fout := fout || ' inhoud_gewijzigd'; end if;
  update public.ai_config set active_kids = active_kids; get diagnostics n = row_count; if n > 0 then fout := fout || ' ai_config_gewijzigd'; end if;
  delete from public.players;              get diagnostics n = row_count; if n > 0 then fout := fout || ' spelers_verwijderd'; end if;

  -- toevoegen: niet voor een ander gezin, en jezelf geen beheerder maken
  if ander is not null then
    begin
      insert into public.players(id, family_id, data) values ('rls_test_x', ander, '{}');
      fout := fout || ' speler_bij_ander_gezin';
    exception when insufficient_privilege or check_violation then null;
    end;
  end if;
  begin
    insert into public.admins(user_id) values ('00000000-0000-0000-0000-0000000000aa');
    fout := fout || ' zelf_beheerder';
  exception when others then null;
  end;

  -- demo-woorden: een gewoon gezin kan de lijst niet zien of beheren
  select count(*) into n from public.demo_words; if n > 0 then fout := fout || ' gezin_ziet_demo_woorden'; end if;
  begin
    insert into public.demo_words(id) values ('rlstest_gezin'); fout := fout || ' gezin_maakt_woord_openbaar';
  exception when others then null;
  end;
  delete from public.demo_words; get diagnostics n = row_count; if n > 0 then fout := fout || ' gezin_verwijdert_demo_woorden'; end if;

  -- TRUNCATE omzeilt RLS: mag een gewoon gezin niet kunnen (slaagt hij toch, dan wordt hij teruggedraaid)
  begin truncate public.demo_words;  raise exception 'rlstest_truncate_gelukt';
  exception when insufficient_privilege then null;
            when others then if sqlerrm = 'rlstest_truncate_gelukt' then fout := fout || ' gezin_leegt_demo_woorden'; end if;
  end;
  begin truncate public.content;     raise exception 'rlstest_truncate_gelukt';
  exception when insufficient_privilege then null;
            when others then if sqlerrm = 'rlstest_truncate_gelukt' then fout := fout || ' gezin_leegt_content'; end if;
  end;

  ---------------------------------------------------------------------------------------------
  -- B. BEHEERDER: kan de lijst met openbare woorden beheren (bestanden: zie storage_api_test.mjs)
  ---------------------------------------------------------------------------------------------
  reset role;
  if beheerder is null then
    fout := fout || ' geen_beheerder_om_te_testen';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', beheerder, 'role', 'authenticated')::text, true);
    set local role authenticated;
    if not public.is_admin() then fout := fout || ' beheerder_niet_herkend'; end if;
    begin
      insert into public.demo_words(id) values ('rlstest_beheer');
    exception when others then fout := fout || ' beheerder_kan_woord_niet_openbaar_maken';
    end;
    select count(*) into n from public.demo_words where id in ('rlstest_demo', 'rlstest_beheer');
    if n <> 2 then fout := fout || ' beheerder_ziet_demo_woorden_niet'; end if;
    delete from public.demo_words where id = 'rlstest_beheer';
    get diagnostics n = row_count; if n <> 1 then fout := fout || ' beheerder_kan_woord_niet_weghalen'; end if;
  end if;

  ---------------------------------------------------------------------------------------------
  -- C. GAST (niet ingelogd, "Proberen zonder account")
  ---------------------------------------------------------------------------------------------
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;

  -- mag WEL: het aangewezen woord, alleen vaste velden
  select count(*) into n from public.demo_content() where id = 'rlstest_demo';
  if n <> 1 then fout := fout || ' gast_ziet_demo_woord_niet'; end if;
  select count(*) into n from public.demo_content() where id = 'rlstest_demo' and (data ? 'note' or data ? 'verified');
  if n > 0 then fout := fout || ' gast_ziet_interne_velden'; end if;

  -- mag NIET lezen: andere woorden, de tabel content zelf, gezinsgegevens
  select count(*) into n from public.demo_content() where id = 'rlstest_intern';
  if n > 0 then fout := fout || ' gast_ziet_intern_woord'; end if;
  begin
    perform 1 from public.content limit 1; fout := fout || ' gast_heeft_tabelrecht_content';
  exception when insufficient_privilege then null;
  end;
  -- ook niet via PUBLIC (iedereen): geen enkel tabelrecht
  if has_table_privilege('anon', 'public.content', 'select,insert,update,delete,truncate,references,trigger') then fout := fout || ' gast_heeft_recht_content'; end if;
  if has_table_privilege('public', 'public.content', 'select,insert,update,delete,truncate,references,trigger') then fout := fout || ' public_heeft_recht_content'; end if;
  begin
    perform 1 from public.demo_words limit 1; fout := fout || ' gast_heeft_tabelrecht_demo_woorden';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from storage.objects where bucket_id <> 'demo'; if n > 0 then fout := fout || ' gast_ziet_andere_bucket'; end if;
  select count(*) into n from public.players;         if n > 0 then fout := fout || ' gast_spelers'; end if;
  select count(*) into n from public.family_settings; if n > 0 then fout := fout || ' gast_instellingen'; end if;
  select count(*) into n from public.ai_config;       if n > 0 then fout := fout || ' gast_ai_config'; end if;
  select count(*) into n from public.admins;          if n > 0 then fout := fout || ' gast_beheerders'; end if;

  -- mag NIETS toevoegen, wijzigen, verwijderen of openbaar maken (bestanden: zie storage_api_test.mjs)
  begin
    insert into public.content(id, data) values ('rlstest_gast', '{}'); fout := fout || ' gast_voegt_inhoud_toe';
  exception when others then null;
  end;
  begin
    update public.content set data = data; get diagnostics n = row_count;
    if n > 0 then fout := fout || ' gast_wijzigt_inhoud'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.demo_words(id) values ('rlstest_gast'); fout := fout || ' gast_maakt_woord_openbaar';
  exception when others then null;
  end;
  begin truncate public.content;  raise exception 'rlstest_truncate_gelukt';
  exception when insufficient_privilege then null;
            when others then if sqlerrm = 'rlstest_truncate_gelukt' then fout := fout || ' gast_leegt_content'; end if;
  end;

  if fout = '' then raise exception 'RLS-TEST GESLAAGD (alles teruggedraaid)';
  else raise exception 'RLS-TEST MISLUKT:% (alles teruggedraaid)', fout; end if;
end $$;
