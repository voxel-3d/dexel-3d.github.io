-- Apply after catalog/admin-full-access.sql (provides public.is_catalog_admin()).
begin;

-- Historical public counts can contain manually set values. Do not copy them.
alter table public.models
  add column if not exists real_views_count integer not null default 0 check (real_views_count >= 0),
  add column if not exists real_downloads_count integer not null default 0 check (real_downloads_count >= 0);

revoke insert (real_views_count, real_downloads_count),
       update (real_views_count, real_downloads_count)
on public.models from public, anon, authenticated;
grant insert (views_count, downloads_count), update (views_count, downloads_count)
on public.models to authenticated;

-- Column grants allow INSERT/UPDATE through PostgREST. Only moderators may seed
-- or edit public counts. The existing model-owner RLS remains in force.
create or replace function public.guard_model_public_counts()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;

  if tg_op = 'INSERT' then
    if new.views_count = 0 and new.downloads_count = 0 then return new; end if;
  elsif new.views_count is not distinct from old.views_count
    and new.downloads_count is not distinct from old.downloads_count then
    return new;
  end if;

  if current_user = 'authenticated' and public.is_catalog_admin() then return new; end if;
  raise insufficient_privilege using message = 'Only catalog moderators may set public model counters';
end;
$$;
revoke all on function public.guard_model_public_counts() from public, anon, authenticated;
drop trigger if exists dexel_guard_model_public_counts on public.models;
create trigger dexel_guard_model_public_counts
before insert or update of views_count, downloads_count on public.models
for each row execute function public.guard_model_public_counts();

create or replace function public.record_model_event(model_id uuid, event_type text)
returns table (views_count bigint, downloads_count bigint, orders_count bigint)
language plpgsql security definer set search_path = '' as $$
declare
  is_moderator boolean := public.is_catalog_admin();
begin
  if event_type is null or event_type not in ('view', 'download', 'order') then
    raise exception 'Invalid model event' using errcode = '22023';
  end if;
  return query
  update public.models as m set
    views_count = m.views_count + case when event_type = 'view' then 1 else 0 end,
    downloads_count = m.downloads_count + case when event_type = 'download' then 1 else 0 end,
    real_views_count = m.real_views_count + case when event_type = 'view' and not is_moderator then 1 else 0 end,
    real_downloads_count = m.real_downloads_count + case when event_type = 'download' and not is_moderator then 1 else 0 end,
    orders_count = m.orders_count + case when event_type = 'order' then 1 else 0 end
  where m.id = model_id and not m.deleting
  returning m.views_count, m.downloads_count, m.orders_count;
end;
$$;
revoke all on function public.record_model_event(uuid, text) from public, anon, authenticated;
grant execute on function public.record_model_event(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
