-- ALLEEN VOOR HET TESTPROJECT. Fictieve basisinstellingen, geen echte gegevens.
-- Draai dit pas NADAT de testaccounts (…@example.test) zijn aangemaakt.
--
-- Beveiliging: stopt meteen als er ook maar één account bestaat dat niet op
-- @example.test eindigt. In het live project (met echte gezinnen) doet dit
-- bestand dus niets.
do $$
begin
  if exists (select 1 from auth.users where email not like '%@example.test') then
    raise exception 'GESTOPT: dit lijkt geen testproject (er bestaan echte accounts).';
  end if;
end $$;

-- AI-taalpartner: uit, zonder sleutel, met een laag budget
insert into public.ai_config (id, active_adult, active_kids, family_daily_msgs, monthly_token_limit)
values (1, false, false, 10, 1000)
on conflict (id) do update set active_adult = false, active_kids = false;

-- Testbeheerder (fictief account)
insert into public.admins (user_id)
select id from auth.users where email = 'beheer@example.test'
on conflict do nothing;
