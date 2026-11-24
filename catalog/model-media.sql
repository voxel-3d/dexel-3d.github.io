-- Run in Supabase SQL Editor after catalog/supabase.sql. Safe to run again.
begin;
alter table public.models add column if not exists media_paths text[] not null default '{}';
create or replace function public.valid_model_media(paths text[], owner_id uuid, model_id uuid)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(cardinality(paths) <= 8 and not exists (
    select 1 from unnest(paths) as p
    where p is null or p !~ ('^' || owner_id::text || '/' || model_id::text || '/[0-9a-f-]{36}[.](webp|gif)$')
  ), false);
$$;
revoke all on function public.valid_model_media(text[],uuid,uuid) from public;
grant execute on function public.valid_model_media(text[],uuid,uuid) to authenticated;
alter table public.models drop constraint if exists models_media_paths_check;
alter table public.models add constraint models_media_paths_check check(public.valid_model_media(media_paths,user_id,id));
grant insert(media_paths), update(media_paths) on public.models to authenticated;
drop trigger if exists dexel_model_media_metadata on public.models;
create trigger dexel_model_media_metadata before update of media_paths on public.models
for each row execute function public.set_dexel_model_metadata();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('model-media','model-media',true,10485760,array['image/webp','image/gif'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Upload own model gallery" on storage.objects;
create policy "Upload own model gallery" on storage.objects for insert to authenticated with check(
 bucket_id='model-media' and (storage.foldername(name))[1]=(select auth.uid())::text
 and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](webp|gif)$'
);
drop policy if exists "Read own model gallery files" on storage.objects;
create policy "Read own model gallery files" on storage.objects for select to authenticated using(
 bucket_id='model-media' and (storage.foldername(name))[1]=(select auth.uid())::text
);
drop policy if exists "Remove own model gallery" on storage.objects;
create policy "Remove own model gallery" on storage.objects for delete to authenticated using(
 bucket_id='model-media' and (storage.foldername(name))[1]=(select auth.uid())::text
);
commit;
