-- Apply after catalog/supabase.sql and catalog/admin-full-access.sql.
begin;

alter table public.models
  add column if not exists original_author text check (char_length(original_author) <= 120),
  add column if not exists source_url text check (
    char_length(source_url) <= 2048 and source_url ~* '^https?://[^[:space:]]+$'
  );
grant insert (original_author, source_url), update (original_author, source_url)
on public.models to authenticated;

drop trigger if exists dexel_model_attribution_metadata on public.models;
create trigger dexel_model_attribution_metadata before update of original_author, source_url
on public.models for each row execute function public.set_dexel_model_metadata();

alter table public.catalog_builtin_models
  add column if not exists original_author text check (char_length(original_author) <= 120),
  add column if not exists source_url text check (
    char_length(source_url) <= 2048 and source_url ~* '^https?://[^[:space:]]+$'
  );

notify pgrst, 'reload schema';
commit;
