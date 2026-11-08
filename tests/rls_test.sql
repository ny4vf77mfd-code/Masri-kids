-- Beveiligingstest (RLS) voor Masri Kids.
-- Doet alsof een onbekend gezin is ingelogd en probeert gegevens van anderen
-- te lezen en te wijzigen. Daarna hetzelfde zonder in te loggen.
--
-- VEILIG: het hele blok eindigt ALTIJD met een foutmelding, waardoor de
-- database alles terugdraait. Er blijft dus nooit iets veranderd achter.
-- De uitslag staat in die foutmelding: "RLS-TEST GESLAAGD" of "RLS-TEST MISLUKT".
do $$
declare
  fout text := '';
  n int;
  ander uuid;
begin
  select family_id into ander from public.players limit 1;  -- kan leeg zijn in een nieuw project
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
  begin
    insert into storage.objects(bucket_id, name) values ('media', 'shared/rls_test.txt');
    fout := fout || ' upload_gedeelde_map';
  exception when others then null;
  end;

  -- niet ingelogd (gast, "Proberen zonder account"): alleen gedeelde map en woordaanpassingen LEZEN
  reset role;
  set local role anon;
  select count(*) into n from public.players;  if n > 0 then fout := fout || ' anon_spelers'; end if;
  select count(*) into n from public.family_settings; if n > 0 then fout := fout || ' anon_instellingen'; end if;
  select count(*) into n from public.ai_config; if n > 0 then fout := fout || ' anon_ai_config'; end if;
  select count(*) into n from public.admins;   if n > 0 then fout := fout || ' anon_beheerders'; end if;
  select count(*) into n from storage.objects
    where bucket_id = 'media' and (storage.foldername(name))[1] <> 'shared';
  if n > 0 then fout := fout || ' anon_gezinsmedia'; end if;
  update public.content set data = data;   get diagnostics n = row_count; if n > 0 then fout := fout || ' anon_inhoud_gewijzigd'; end if;
  begin
    delete from public.content;            get diagnostics n = row_count; if n > 0 then fout := fout || ' anon_inhoud_verwijderd'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.content(id, data) values ('rls_test_gast', '{}');
    fout := fout || ' anon_inhoud_toegevoegd';
  exception when others then null;
  end;
  begin
    insert into storage.objects(bucket_id, name) values ('media', 'shared/rls_test_gast.txt');
    fout := fout || ' anon_upload';
  exception when others then null;
  end;
  update storage.objects set name = name where bucket_id = 'media';
  get diagnostics n = row_count; if n > 0 then fout := fout || ' anon_media_gewijzigd'; end if;
  begin
    delete from storage.objects where bucket_id = 'media'; get diagnostics n = row_count; if n > 0 then fout := fout || ' anon_media_verwijderd'; end if;
  exception when insufficient_privilege then null;
  end;

  if fout = '' then raise exception 'RLS-TEST GESLAAGD (alles teruggedraaid)';
  else raise exception 'RLS-TEST MISLUKT:% (alles teruggedraaid)', fout; end if;
end $$;
