-- Apply after catalog/social.sql. The admin check matches admin-full-access.sql.
begin;

create or replace function public.is_catalog_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and lower(email) = 'igorkruk747@gmail.com'
      and email_confirmed_at is not null
  );
$$;
revoke all on function public.is_catalog_admin() from public, anon;
grant execute on function public.is_catalog_admin() to authenticated;

-- The existing author policy remains in effect.
drop policy if exists "Catalog admin deletes makes" on public.model_makes;
create policy "Catalog admin deletes makes" on public.model_makes
for delete to authenticated using ((select public.is_catalog_admin()));

-- Storage remove needs both SELECT and DELETE. Scope both to Makes photos.
drop policy if exists "Catalog admin reads make photos" on storage.objects;
create policy "Catalog admin reads make photos" on storage.objects
for select to authenticated using (
  bucket_id = 'catalog-social' and (storage.foldername(name))[1] = 'makes'
  and (select public.is_catalog_admin())
);

drop policy if exists "Catalog admin deletes make photos" on storage.objects;
create policy "Catalog admin deletes make photos" on storage.objects
for delete to authenticated using (
  bucket_id = 'catalog-social' and (storage.foldername(name))[1] = 'makes'
  and (select public.is_catalog_admin())
);

commit;
