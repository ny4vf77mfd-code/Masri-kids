-- Proberen zonder account: gasten (rol anon) mogen ALLEEN lezen:
--  - bestanden in de gedeelde map media/shared/ (opnames en woordplaatjes van de beheerder)
--  - de woordaanpassingen in public.content
-- Gasten kunnen niets toevoegen, wijzigen of verwijderen, en zien nooit de mappen van gezinnen.
create policy "gast leest gedeelde media" on storage.objects
  for select to anon
  using (bucket_id = 'media' and (storage.foldername(name))[1] = 'shared');

create policy "gast leest inhoud" on public.content
  for select to anon
  using (true);

grant select on public.content to anon;
