-- CommonGround schema v1
-- Run this migration against your Supabase project.

-- A discussion room. Two users per room for v1.
create table rooms (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_a_id     text not null,
  user_b_id     text not null,
  rubric_id     text not null default 'default_v1',
  status        text not null default 'active' -- active | paused | closed
);

-- Messages that passed moderation and are visible to both users.
create table main_messages (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references rooms(id) on delete cascade,
  sender_id       text not null,
  content         text not null,
  revision_count  int not null default 0,
  created_at      timestamptz not null default now()
);

create index idx_main_messages_room on main_messages(room_id, created_at);

-- Facts both users have accepted. Moderator uses these as memory.
create table established_facts (
  id                      uuid primary key default gen_random_uuid(),
  room_id                 uuid not null references rooms(id) on delete cascade,
  content                 text not null,
  established_by_message_id uuid references main_messages(id),
  created_at              timestamptz not null default now()
);

create index idx_established_facts_room on established_facts(room_id, created_at);

-- Private per-user side-chat with the AI while revising a draft.
create table side_chat_messages (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null references rooms(id) on delete cascade,
  user_id           text not null,
  role              text not null, -- 'user' | 'ai'
  content           text not null,
  draft_session_id  uuid not null,
  created_at        timestamptz not null default now()
);

create index idx_side_chat_room_user on side_chat_messages(room_id, user_id, draft_session_id, created_at);

-- Tracks a user's in-progress draft session.
create table pending_drafts (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references rooms(id) on delete cascade,
  user_id         text not null,
  current_content text not null,
  rejection_count int not null default 0,
  draft_session_id uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(room_id, user_id)
);

-- Audit log of every moderation decision, for debugging and user appeals.
create table moderation_decisions (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references rooms(id) on delete cascade,
  user_id       text not null,
  draft_content text not null,
  verdict       text not null, -- 'approve' | 'revise'
  violated_rules jsonb,
  explanation   text,
  model         text not null,
  latency_ms    int,
  created_at    timestamptz not null default now()
);

create index idx_moderation_decisions_room on moderation_decisions(room_id, created_at);

-- Enable Supabase Realtime for the tables clients subscribe to.
alter publication supabase_realtime add table main_messages;
alter publication supabase_realtime add table established_facts;
alter publication supabase_realtime add table side_chat_messages;
