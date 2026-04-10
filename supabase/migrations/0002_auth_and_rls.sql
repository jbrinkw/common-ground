-- CommonGround: Auth, schema changes, and RLS policies

-- ============================================================
-- 1. New tables
-- ============================================================

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

-- ============================================================
-- 2. Auto-create profile on signup
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'display_name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 3. Drop existing data and recreate tables with proper types
--    (This is a breaking migration — existing data is wiped)
-- ============================================================

drop table if exists moderation_decisions;
drop table if exists pending_drafts;
drop table if exists side_chat_messages;
drop table if exists established_facts;
drop table if exists main_messages;
drop table if exists rooms;

create table rooms (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_a_id     uuid not null references profiles(id),
  user_b_id     uuid references profiles(id),
  rubric_id     text not null default 'default_v1',
  status        text not null default 'active',
  invite_code   text not null,
  invite_token  uuid not null default gen_random_uuid()
);

create unique index idx_rooms_invite_code on rooms(invite_code);
create unique index idx_rooms_invite_token on rooms(invite_token);

create table main_messages (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references rooms(id) on delete cascade,
  sender_id       uuid not null references profiles(id),
  content         text not null,
  revision_count  int not null default 0,
  created_at      timestamptz not null default now()
);

create index idx_main_messages_room on main_messages(room_id, created_at);

create table established_facts (
  id                        uuid primary key default gen_random_uuid(),
  room_id                   uuid not null references rooms(id) on delete cascade,
  content                   text not null,
  established_by_message_id uuid references main_messages(id),
  created_at                timestamptz not null default now()
);

create index idx_established_facts_room on established_facts(room_id, created_at);

create table side_chat_messages (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null references rooms(id) on delete cascade,
  user_id           uuid not null references profiles(id),
  role              text not null,
  content           text not null,
  draft_session_id  uuid not null,
  created_at        timestamptz not null default now()
);

create index idx_side_chat_room_user on side_chat_messages(room_id, user_id, draft_session_id, created_at);

create table pending_drafts (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references rooms(id) on delete cascade,
  user_id          uuid not null references profiles(id),
  current_content  text not null,
  rejection_count  int not null default 0,
  draft_session_id uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique(room_id, user_id)
);

create table moderation_decisions (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references rooms(id) on delete cascade,
  user_id       uuid not null references profiles(id),
  draft_content text not null,
  verdict       text not null,
  violated_rules jsonb,
  explanation   text,
  model         text not null,
  latency_ms    int,
  created_at    timestamptz not null default now()
);

create index idx_moderation_decisions_room on moderation_decisions(room_id, created_at);

alter publication supabase_realtime add table main_messages;
alter publication supabase_realtime add table established_facts;
alter publication supabase_realtime add table side_chat_messages;

-- ============================================================
-- 4. RLS policies
-- ============================================================

create or replace function public.is_room_participant(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists(
    select 1 from public.rooms
    where id = p_room_id
    and (user_a_id = p_user_id or user_b_id = p_user_id)
  );
$$;

-- profiles
alter table profiles enable row level security;
create policy "Authenticated users can read any profile"
  on profiles for select to authenticated using (true);
create policy "Users can update own profile"
  on profiles for update to authenticated using ((select auth.uid()) = id);

-- rooms
alter table rooms enable row level security;
create policy "Participants can view their rooms"
  on rooms for select to authenticated
  using (user_a_id = (select auth.uid()) or user_b_id = (select auth.uid()));
create policy "Authenticated users can create rooms"
  on rooms for insert to authenticated
  with check (user_a_id = (select auth.uid()));
create policy "Participants can update rooms"
  on rooms for update to authenticated
  using (user_a_id = (select auth.uid()) or user_b_id = (select auth.uid()));
create policy "Anyone can read rooms by invite token for joining"
  on rooms for select to authenticated
  using (user_b_id is null);

-- main_messages
alter table main_messages enable row level security;
create policy "Room participants can read messages"
  on main_messages for select to authenticated
  using (public.is_room_participant(room_id, (select auth.uid())));
create policy "Room participants can insert own messages"
  on main_messages for insert to authenticated
  with check (
    public.is_room_participant(room_id, (select auth.uid()))
    and sender_id = (select auth.uid())
  );

-- established_facts
alter table established_facts enable row level security;
create policy "Room participants can read facts"
  on established_facts for select to authenticated
  using (public.is_room_participant(room_id, (select auth.uid())));
create policy "Room participants can insert facts"
  on established_facts for insert to authenticated
  with check (public.is_room_participant(room_id, (select auth.uid())));

-- side_chat_messages
alter table side_chat_messages enable row level security;
create policy "Users can read own side chat"
  on side_chat_messages for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users can insert own side chat"
  on side_chat_messages for insert to authenticated
  with check (user_id = (select auth.uid()));

-- pending_drafts
alter table pending_drafts enable row level security;
create policy "Users can manage own drafts"
  on pending_drafts for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- moderation_decisions
alter table moderation_decisions enable row level security;
create policy "Users can read own moderation decisions"
  on moderation_decisions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users can insert own moderation decisions"
  on moderation_decisions for insert to authenticated
  with check (user_id = (select auth.uid()));

-- push_subscriptions
alter table push_subscriptions enable row level security;
create policy "Users can manage own push subscriptions"
  on push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
