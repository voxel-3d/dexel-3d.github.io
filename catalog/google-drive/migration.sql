-- Run AFTER catalog/supabase.sql (and the existing geometry/social migrations).
-- Keeps existing STL/PNG objects readable. Does not move or delete existing files.
begin;
alter table public.models drop constraint if exists model_stl_path;
alter table public.models add constraint model_stl_path check (
  stl_path ~ ('^' || user_id::text || '/' || id::text || '/([0-9a-f-]{36}|drive-[A-Za-z0-9_-]{10,160})[.]stl$')
);
alter table public.models drop constraint if exists model_cover_path;
alter table public.models add constraint model_cover_path check (
  cover_path ~ ('^' || user_id::text || '/' || id::text || '/[0-9a-f-]{36}[.](png|webp)$')
);
-- Only new WebP covers enter this bucket. Existing files remain downloadable/deletable.
update storage.buckets set allowed_mime_types = array['image/webp'], file_size_limit = 2097152
where id = 'stl-models';
drop policy if exists "Upload own model assets" on storage.objects;
create policy "Upload own model assets" on storage.objects
for insert to authenticated with check (
  bucket_id = 'stl-models'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.]webp$'
);
commit;
