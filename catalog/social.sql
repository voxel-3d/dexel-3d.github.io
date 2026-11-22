begin;

-- Public model identifiers include the built-in demos and published UUIDs.
create or replace function public.dexel_model_exists(model_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select model_key in ('ribbed-vase','phone-stand','hex-organizer')
    or exists (select 1 from public.models m where m.id::text = model_key and not m.deleting);
$$;
revoke all on function public.dexel_model_exists(text) from public;
grant execute on function public.dexel_model_exists(text) to anon, authenticated;

create table if not exists public.favorites (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  model_key text not null,
  created_at timestamptz not null default now(),
  primary key(user_id, model_key)
);
create table if not exists public.model_makes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  model_key text not null,
  author_name text not null default 'Автор DEXEL 3D' check (char_length(author_name) <= 80),
  material text not null check (material in ('PLA','PETG','ABS')),
  comment text not null default '' check (char_length(comment) <= 300),
  photo_path text not null check (photo_path ~ ('^makes/' || user_id::text || '/[0-9a-f-]{36}[.]jpg$')),
  created_at timestamptz not null default now()
);
create table if not exists public.model_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null default 'Автор DEXEL 3D' check (char_length(author_name) <= 80),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  description text not null check (char_length(btrim(description)) between 1 and 1000),
  photo_path text check (photo_path is null or photo_path ~ ('^requests/' || user_id::text || '/[0-9a-f-]{36}[.]jpg$')),
  status text not null default 'Ищем исполнителя' check (status in ('Ищем исполнителя','В работе','Готово')),
  ready_model text,
  created_at timestamptz not null default now(),
  check ((status = 'Готово' and ready_model is not null) or (status <> 'Готово' and ready_model is null))
);
create table if not exists public.request_votes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  request_id uuid not null references public.model_requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);

create index if not exists model_makes_model_idx on public.model_makes(model_key, created_at desc);
create index if not exists request_votes_request_idx on public.request_votes(request_id);

create or replace function public.dexel_social_author()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.author_name := coalesce(nullif(left(btrim(auth.jwt()->'user_metadata'->>'display_name'),80),''),'Автор DEXEL 3D');
  return new;
end;
$$;
revoke all on function public.dexel_social_author() from public;
drop trigger if exists make_author on public.model_makes;
create trigger make_author before insert on public.model_makes for each row execute function public.dexel_social_author();
drop trigger if exists request_author on public.model_requests;
create trigger request_author before insert on public.model_requests for each row execute function public.dexel_social_author();

alter table public.favorites enable row level security;
alter table public.model_makes enable row level security;
alter table public.model_requests enable row level security;
alter table public.request_votes enable row level security;
revoke all on public.favorites, public.model_makes, public.model_requests, public.request_votes from public, anon, authenticated;
grant select on public.model_makes, public.model_requests to anon, authenticated;
grant select on public.favorites, public.request_votes to authenticated;
grant insert(model_key), delete on public.favorites to authenticated;
grant insert(id,model_key,material,comment,photo_path), delete on public.model_makes to authenticated;
grant insert(id,title,description,photo_path), delete on public.model_requests to authenticated;
grant update(status,ready_model) on public.model_requests to authenticated;
grant insert(request_id), delete on public.request_votes to authenticated;

drop policy if exists "Read own favorites" on public.favorites;
create policy "Read own favorites" on public.favorites for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Add own favorite" on public.favorites;
create policy "Add own favorite" on public.favorites for insert to authenticated
  with check (user_id = (select auth.uid()) and public.dexel_model_exists(model_key));
drop policy if exists "Remove own favorite" on public.favorites;
create policy "Remove own favorite" on public.favorites for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Read makes" on public.model_makes;
create policy "Read makes" on public.model_makes for select to anon, authenticated using (public.dexel_model_exists(model_key));
drop policy if exists "Create own make" on public.model_makes;
create policy "Create own make" on public.model_makes for insert to authenticated
  with check (user_id = (select auth.uid()) and public.dexel_model_exists(model_key));
drop policy if exists "Delete own make" on public.model_makes;
create policy "Delete own make" on public.model_makes for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Read requests" on public.model_requests;
create policy "Read requests" on public.model_requests for select to anon, authenticated using (true);
drop policy if exists "Create own request" on public.model_requests;
create policy "Create own request" on public.model_requests for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "Update own request" on public.model_requests;
create policy "Update own request" on public.model_requests for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (ready_model is null or public.dexel_model_exists(ready_model)));
drop policy if exists "Delete own request" on public.model_requests;
create policy "Delete own request" on public.model_requests for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Read own votes" on public.request_votes;
create policy "Read own votes" on public.request_votes for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Vote for another author" on public.request_votes;
create policy "Vote for another author" on public.request_votes for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (select 1 from public.model_requests r where r.id = request_id and r.user_id <> (select auth.uid()))
);
drop policy if exists "Remove own vote" on public.request_votes;
create policy "Remove own vote" on public.request_votes for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.favorite_counts()
returns table(model_key text, count bigint) language sql stable security definer set search_path = '' as $$
  select f.model_key, count(*) from public.favorites f where public.dexel_model_exists(f.model_key) group by f.model_key;
$$;
create or replace function public.request_vote_counts()
returns table(request_id uuid, count bigint) language sql stable security definer set search_path = '' as $$
  select v.request_id, count(*) from public.request_votes v group by v.request_id;
$$;
create or replace function public.popular_model_authors()
returns table(user_id uuid, author_name text, views numeric, downloads numeric) language sql stable security definer set search_path = '' as $$
  select m.user_id, max(m.author_name), sum(m.views_count), sum(m.downloads_count)
  from public.models m where not m.deleting group by m.user_id
  order by (sum(m.views_count) + sum(m.downloads_count)) desc, m.user_id limit 5;
$$;
revoke all on function public.favorite_counts(), public.request_vote_counts(), public.popular_model_authors() from public;
grant execute on function public.favorite_counts(), public.request_vote_counts(), public.popular_model_authors() to anon, authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('catalog-social','catalog-social',true,10485760,array['image/jpeg'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Upload own social photos" on storage.objects;
create policy "Upload own social photos" on storage.objects for insert to authenticated with check (
  bucket_id = 'catalog-social' and (storage.foldername(name))[1] in ('makes','requests')
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and name ~ '^(makes|requests)/[0-9a-f-]{36}/[0-9a-f-]{36}[.]jpg$'
);
drop policy if exists "List own social photos" on storage.objects;
create policy "List own social photos" on storage.objects for select to authenticated using (
  bucket_id='catalog-social' and (storage.foldername(name))[2]=(select auth.uid())::text
);
drop policy if exists "Delete own social photos" on storage.objects;
create policy "Delete own social photos" on storage.objects for delete to authenticated using (
  bucket_id='catalog-social' and (storage.foldername(name))[2]=(select auth.uid())::text
);

commit;
