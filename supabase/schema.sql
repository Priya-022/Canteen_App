create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 48),
  description text not null check (char_length(description) between 1 and 90),
  price integer not null check (price between 1 and 9999),
  category text not null check (category in ('veg', 'non-veg')),
  available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.canteen_specials (
  special_date date primary key,
  name text not null check (char_length(name) between 1 and 48),
  description text not null check (char_length(description) between 1 and 120),
  price integer not null check (price between 1 and 9999),
  updated_at timestamptz not null default now()
);

create table if not exists public.canteen_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.crowd_votes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  score smallint not null check (score between 1 and 3),
  voted_at timestamptz not null default now()
);

create index if not exists crowd_votes_voted_at_idx
  on public.crowd_votes (voted_at desc);

alter table public.menu_items enable row level security;
alter table public.canteen_specials enable row level security;
alter table public.canteen_admins enable row level security;
alter table public.crowd_votes enable row level security;

drop policy if exists menu_items_read on public.menu_items;
create policy menu_items_read on public.menu_items
  for select to authenticated using (true);

drop policy if exists menu_items_guest_read on public.menu_items;
create policy menu_items_guest_read on public.menu_items
  for select to anon using (true);

drop policy if exists menu_items_admin_insert on public.menu_items;
create policy menu_items_admin_insert on public.menu_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.canteen_admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists menu_items_admin_update on public.menu_items;
create policy menu_items_admin_update on public.menu_items
  for update to authenticated
  using (
    exists (
      select 1 from public.canteen_admins a
      where a.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.canteen_admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists menu_items_admin_delete on public.menu_items;
create policy menu_items_admin_delete on public.menu_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.canteen_admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists canteen_specials_read on public.canteen_specials;
create policy canteen_specials_read on public.canteen_specials
  for select to authenticated using (true);

drop policy if exists canteen_specials_guest_read on public.canteen_specials;
create policy canteen_specials_guest_read on public.canteen_specials
  for select to anon using (true);

drop policy if exists canteen_specials_admin_insert on public.canteen_specials;
create policy canteen_specials_admin_insert on public.canteen_specials
  for insert to authenticated
  with check (
    exists (
      select 1 from public.canteen_admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists canteen_specials_admin_update on public.canteen_specials;
create policy canteen_specials_admin_update on public.canteen_specials
  for update to authenticated
  using (
    exists (
      select 1 from public.canteen_admins a
      where a.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.canteen_admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists canteen_admins_read_self on public.canteen_admins;
create policy canteen_admins_read_self on public.canteen_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists crowd_votes_read_self on public.crowd_votes;
create policy crowd_votes_read_self on public.crowd_votes
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists crowd_votes_insert_self on public.crowd_votes;
create policy crowd_votes_insert_self on public.crowd_votes
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists crowd_votes_update_self on public.crowd_votes;
create policy crowd_votes_update_self on public.crowd_votes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.set_crowd_vote_time()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.voted_at := now();
  return new;
end;
$$;

drop trigger if exists crowd_votes_set_time on public.crowd_votes;
create trigger crowd_votes_set_time
  before insert or update on public.crowd_votes
  for each row execute function public.set_crowd_vote_time();

create or replace function public.get_crowd_summary()
returns table (average_score numeric, vote_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(avg(v.score)::numeric, 2::numeric), count(*)
  from public.crowd_votes v
  where v.voted_at >= now() - interval '60 minutes';
$$;

revoke all on function public.get_crowd_summary() from public, anon, authenticated;
grant execute on function public.get_crowd_summary() to anon;
grant execute on function public.get_crowd_summary() to authenticated;
revoke all on function public.set_crowd_vote_time() from public, anon, authenticated;

grant usage on schema public to authenticated;
revoke all on public.menu_items, public.canteen_specials, public.canteen_admins, public.crowd_votes
  from anon, authenticated;
grant select, insert, update, delete on public.menu_items to authenticated;
grant select, insert, update on public.canteen_specials to authenticated;
grant select on public.canteen_admins to authenticated;
grant select, insert, update on public.crowd_votes to authenticated;
grant select on public.menu_items, public.canteen_specials to anon;

insert into public.menu_items (id, name, description, price, category, available, sort_order)
values
  ('10000000-0000-4000-8000-000000000001', 'Paneer tikka wrap', 'Smoky paneer, crunchy greens & mint chutney.', 90, 'veg', true, 1),
  ('10000000-0000-4000-8000-000000000002', 'Campus chicken bowl', 'Spiced chicken, warm rice & a little zing.', 120, 'non-veg', true, 2),
  ('10000000-0000-4000-8000-000000000003', 'Garden masala dosa', 'Golden, crisp & served with coconut chutney.', 75, 'veg', true, 3),
  ('10000000-0000-4000-8000-000000000004', 'Chilli cheese toast', 'Toasty, cheesy, just the right amount of kick.', 55, 'veg', false, 4),
  ('10000000-0000-4000-8000-000000000005', 'Egg fried rice', 'Wok-tossed rice with egg, veggies & spring onion.', 95, 'non-veg', true, 5),
  ('10000000-0000-4000-8000-000000000006', 'Mango lassi', 'Cool, creamy & made with real mango.', 45, 'veg', true, 6)
on conflict (id) do nothing;

insert into public.canteen_specials (special_date, name, description, price)
values (
  current_date,
  'Paneer tikka rice bowl',
  'Charred, spice-kissed paneer over fluffy jeera rice, with a bright little mint salad on the side.',
  110
)
on conflict (special_date) do nothing;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'menu_items'
    ) then
      alter publication supabase_realtime add table public.menu_items;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'canteen_specials'
    ) then
      alter publication supabase_realtime add table public.canteen_specials;
    end if;
  end if;
end;
$$;
