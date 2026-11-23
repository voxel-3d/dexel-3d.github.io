-- Apply once to the existing Supabase project (safe to run repeatedly).
-- Existing descriptions are preserved. Only model descriptions become optional.
begin;
alter table public.models drop constraint if exists models_description_check;
alter table public.models alter column description set default '';
alter table public.models add constraint models_description_check
  check (char_length(btrim(description)) <= 500);
commit;
