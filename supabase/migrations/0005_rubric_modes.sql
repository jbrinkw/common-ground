create table rubric_proposals (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references rooms(id) on delete cascade,
  proposed_by   uuid not null references profiles(id),
  rubric_id     text not null,
  status        text not null default 'pending',
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

alter table rubric_proposals enable row level security;
create policy "Room participants can manage rubric proposals"
  on rubric_proposals for all to authenticated
  using (
    exists(
      select 1 from rooms
      where rooms.id = rubric_proposals.room_id
      and (rooms.user_a_id = (select auth.uid()) or rooms.user_b_id = (select auth.uid()))
    )
  )
  with check (
    exists(
      select 1 from rooms
      where rooms.id = rubric_proposals.room_id
      and (rooms.user_a_id = (select auth.uid()) or rooms.user_b_id = (select auth.uid()))
    )
  );

alter publication supabase_realtime add table rubric_proposals;
