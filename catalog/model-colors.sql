-- Run after showcase-and-orders.sql and admin-full-access.sql.
begin;
alter table public.models add column if not exists cover_color text
  not null default '#23272e' check (cover_color ~ '^#[0-9a-f]{6}$');
grant insert (cover_color), update (cover_color) on public.models to authenticated;
drop trigger if exists dexel_model_color_metadata on public.models;
create trigger dexel_model_color_metadata before update of cover_color on public.models
for each row execute function public.set_dexel_model_metadata();
alter table public.catalog_builtin_models
  add column if not exists cover_color text check (cover_color ~ '^#[0-9a-f]{6}$'),
  add column if not exists studio_cover_path text check (
    studio_cover_path is null or (
      owner_id is not null and media_namespace is not null and
      public.valid_model_media(array[studio_cover_path], owner_id, media_namespace)
    )
  );
notify pgrst, 'reload schema';
commit;
