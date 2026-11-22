begin;

create table if not exists public.models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null default 'Автор DEXEL 3D' check (char_length(btrim(author_name)) between 1 and 80),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  description text not null check (char_length(btrim(description)) between 1 and 500),
  category text not null default '' check (char_length(category) <= 60),
  tags text[] not null default '{}' check (cardinality(tags) <= 8 and char_length(array_to_string(tags, ',')) <= 251),
  stl_path text not null,
  cover_path text not null,
  cover_azimuth smallint not null default 45 check (cover_azimuth between -180 and 180),
  cover_elevation smallint not null default 40 check (cover_elevation between 0 and 85),
  views_count bigint not null default 0 check (views_count >= 0),
  downloads_count bigint not null default 0 check (downloads_count >= 0),
  orders_count bigint not null default 0 check (orders_count >= 0),
  deleting boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint model_stl_path check (
    stl_path ~ ('^' || user_id::text || '/' || id::text || '/[0-9a-f-]{36}[.]stl$')
  ),
  constraint model_cover_path check (
    cover_path ~ ('^' || user_id::text || '/' || id::text || '/[0-9a-f-]{36}[.]png$')
  )
);

create index if not exists models_author_idx on public.models (user_id, created_at desc, id);
create index if not exists models_catalog_idx on public.models (created_at desc, id) where not deleting;

create or replace function public.set_dexel_model_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.author_name := coalesce(
      nullif(left(btrim(auth.jwt() -> 'user_metadata' ->> 'display_name'), 80), ''),
      'Автор DEXEL 3D'
    );
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function public.set_dexel_model_metadata() from public, anon, authenticated;
drop trigger if exists dexel_model_metadata on public.models;
create trigger dexel_model_metadata
before insert or update of title, description, category, tags, stl_path, cover_path, cover_azimuth, cover_elevation, deleting
on public.models for each row execute function public.set_dexel_model_metadata();

alter table public.models enable row level security;
revoke all on public.models from public, anon, authenticated;
grant select on public.models to anon, authenticated;
grant insert (id, title, description, category, tags, stl_path, cover_path, cover_azimuth, cover_elevation) on public.models to authenticated;
grant update (title, description, category, tags, stl_path, cover_path, cover_azimuth, cover_elevation, deleting) on public.models to authenticated;
grant delete on public.models to authenticated;

drop policy if exists "Read public models and own pending records" on public.models;
create policy "Read public models and own pending records" on public.models
for select to anon, authenticated using (not deleting or user_id = (select auth.uid()));

drop policy if exists "Insert own models" on public.models;
create policy "Insert own models" on public.models
for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "Update own models" on public.models;
create policy "Update own models" on public.models
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Delete own unpublished models" on public.models;
create policy "Delete own unpublished models" on public.models
for delete to authenticated using (user_id = (select auth.uid()) and deleting);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stl-models', 'stl-models', true, 20971520, array['model/stl', 'image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Upload own model assets" on storage.objects;
create policy "Upload own model assets" on storage.objects
for insert to authenticated with check (
  bucket_id = 'stl-models'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](stl|png)$'
);

drop policy if exists "List own model assets" on storage.objects;
create policy "List own model assets" on storage.objects
for select to authenticated using (
  bucket_id = 'stl-models' and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Remove own model assets" on storage.objects;
create policy "Remove own model assets" on storage.objects
for delete to authenticated using (
  bucket_id = 'stl-models' and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- One atomic increment. Browser roles have no direct write grants on counters.
create or replace function public.record_model_event(model_id uuid, event_type text)
returns table (views_count bigint, downloads_count bigint, orders_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if event_type is null or event_type not in ('view', 'download', 'order') then
    raise exception 'Invalid model event' using errcode = '22023';
  end if;
  return query
  update public.models as m set
    views_count = m.views_count + case when event_type = 'view' then 1 else 0 end,
    downloads_count = m.downloads_count + case when event_type = 'download' then 1 else 0 end,
    orders_count = m.orders_count + case when event_type = 'order' then 1 else 0 end
  where m.id = model_id and not m.deleting
  returning m.views_count, m.downloads_count, m.orders_count;
end;
$$;

revoke all on function public.record_model_event(uuid, text) from public, anon, authenticated;
grant execute on function public.record_model_event(uuid, text) to anon, authenticated;

alter table public.models add column if not exists geometry_metrics jsonb;
grant insert (geometry_metrics), update (geometry_metrics) on public.models to authenticated;

commit;
