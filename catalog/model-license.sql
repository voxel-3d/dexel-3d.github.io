begin;
alter table public.models add column if not exists license_label text check (char_length(license_label) <= 100);
alter table public.catalog_builtin_models add column if not exists license_label text check (char_length(license_label) <= 100);
grant insert (license_label), update (license_label) on public.models to authenticated;
-- Existing owner/admin RLS and builtin access policies remain in force.
drop trigger if exists dexel_model_license_metadata on public.models;
create trigger dexel_model_license_metadata before update of license_label
on public.models for each row execute function public.set_dexel_model_metadata();
notify pgrst, 'reload schema';
commit;
