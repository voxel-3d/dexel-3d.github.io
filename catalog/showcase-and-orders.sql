begin;
alter table public.models
  add column if not exists is_featured boolean not null default false,
  add column if not exists featured_rank integer not null default 100 check (featured_rank > 0),
  add column if not exists allow_download boolean not null default true;

grant insert (is_featured, featured_rank, allow_download),
      update (is_featured, featured_rank, allow_download)
on public.models to authenticated;

drop trigger if exists dexel_model_showcase_metadata on public.models;
create trigger dexel_model_showcase_metadata
before update of is_featured, featured_rank, allow_download on public.models
for each row execute function public.set_dexel_model_metadata();

-- Moderators can manage storefront settings without changing ownership or assets.
create or replace function public.set_showcase_settings(
  model_id uuid, featured boolean, rank integer, downloadable boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or lower(coalesce(auth.jwt()->>'email','')) <> 'igorkruk747@gmail.com'
    or not exists (select 1 from auth.users where id = auth.uid() and lower(email) = 'igorkruk747@gmail.com' and email_confirmed_at is not null)
  then raise insufficient_privilege; end if;
  update public.models set is_featured=featured, featured_rank=rank, allow_download=downloadable
    where id=model_id and not deleting;
  if not found then raise no_data_found; end if;
end;
$$;
revoke all on function public.set_showcase_settings(uuid,boolean,integer,boolean) from public, anon;
grant execute on function public.set_showcase_settings(uuid,boolean,integer,boolean) to authenticated;
commit;
