-- supabase/migrations/0004_room_visits.sql
create table room_visits (
  user_id    uuid not null references profiles(id) on delete cascade,
  room_id    uuid not null references rooms(id) on delete cascade,
  last_seen  timestamptz not null default now(),
  primary key (user_id, room_id)
);

alter table room_visits enable row level security;
create policy "Users can manage own visits"
  on room_visits for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
