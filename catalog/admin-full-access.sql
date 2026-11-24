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

grant select on public.models to authenticated;
grant delete on public.models to authenticated;

drop policy if exists "Catalog admin reads models" on public.models;
create policy "Catalog admin reads models" on public.models for select to authenticated using ((select public.is_catalog_admin()));
drop policy if exists "Catalog admin updates models" on public.models;
create policy "Catalog admin updates models" on public.models for update to authenticated
  using ((select public.is_catalog_admin())) with check ((select public.is_catalog_admin()));
drop policy if exists "Catalog admin deletes models" on public.models;
create policy "Catalog admin deletes models" on public.models for delete to authenticated using ((select public.is_catalog_admin()));

-- Gallery paths in the current schema are stored in models.media_paths.
-- Also support databases with a separate model_media table.
do $$
begin
  if to_regclass('public.model_media') is not null then
    execute 'alter table public.model_media enable row level security';
    execute 'grant select, update, delete on public.model_media to authenticated';
    execute 'drop policy if exists "Catalog admin manages model media" on public.model_media';
    execute 'create policy "Catalog admin manages model media" on public.model_media for all to authenticated using ((select public.is_catalog_admin())) with check ((select public.is_catalog_admin()))';
  end if;
end;
$$;

drop policy if exists "Catalog admin reads model files" on storage.objects;
create policy "Catalog admin reads model files" on storage.objects for select to authenticated
  using (bucket_id in ('stl-models','model-media') and (select public.is_catalog_admin()));
drop policy if exists "Catalog admin inserts model files" on storage.objects;
create policy "Catalog admin inserts model files" on storage.objects for insert to authenticated
  with check ((select public.is_catalog_admin()) and (
    (bucket_id = 'stl-models' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.]webp$') or
    (bucket_id = 'model-media' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](webp|gif)$')
  ));
drop policy if exists "Catalog admin updates model files" on storage.objects;
create policy "Catalog admin updates model files" on storage.objects for update to authenticated
  using (bucket_id in ('stl-models','model-media') and (select public.is_catalog_admin()))
  with check (bucket_id in ('stl-models','model-media') and (select public.is_catalog_admin()));
drop policy if exists "Catalog admin deletes model files" on storage.objects;
create policy "Catalog admin deletes model files" on storage.objects for delete to authenticated
  using (bucket_id in ('stl-models','model-media') and (select public.is_catalog_admin()));

create table if not exists public.catalog_builtin_models (
  slug text primary key check (slug in ('ribbed-vase','phone-stand','hex-organizer')),
  revision uuid not null default gen_random_uuid(),
  hidden boolean not null default false,
  title text check (char_length(btrim(title)) between 1 and 100),
  description text check (char_length(description) <= 500),
  category text check (char_length(category) <= 60),
  is_featured boolean not null default false,
  featured_rank integer not null default 100 check (featured_rank > 0),
  allow_download boolean not null default true,
  media_paths text[] not null default '{}',
  media_namespace uuid,
  owner_id uuid references auth.users(id),
  check ((owner_id is not null and media_namespace is not null and
    public.valid_model_media(media_paths, owner_id, media_namespace)) or cardinality(media_paths) = 0)
);
alter table public.catalog_builtin_models enable row level security;
grant select on public.catalog_builtin_models to anon, authenticated;
grant insert, update, delete on public.catalog_builtin_models to authenticated;
drop policy if exists "Read built-in catalog settings" on public.catalog_builtin_models;
create policy "Read built-in catalog settings" on public.catalog_builtin_models for select to anon, authenticated using (true);
drop policy if exists "Catalog admin manages built-ins" on public.catalog_builtin_models;
create policy "Catalog admin manages built-ins" on public.catalog_builtin_models for all to authenticated
  using ((select public.is_catalog_admin())) with check ((select public.is_catalog_admin()));

notify pgrst, 'reload schema';
commit;
