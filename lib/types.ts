export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
};

export type Room = {
  id: string;
  created_at: string;
  user_a_id: string;
  user_b_id: string | null;
  rubric_id: string;
  status: "active" | "paused" | "closed";
  invite_code: string;
  invite_token: string;
  topic: string | null;
};

export type MainMessage = {
  id: string;
  room_id: string;
  sender_id: string;
  content: string;
  revision_count: number;
  created_at: string;
};

export type EstablishedFact = {
  id: string;
  room_id: string;
  content: string;
  established_by_message_id: string | null;
  created_at: string;
};

export type SideChatMessage = {
  id: string;
  room_id: string;
  user_id: string;
  role: "user" | "ai";
  content: string;
  draft_session_id: string;
  created_at: string;
};

export type PendingDraft = {
  id: string;
  room_id: string;
  user_id: string;
  current_content: string;
  rejection_count: number;
  draft_session_id: string;
  created_at: string;
  updated_at: string;
};

export type ModerationDecision = {
  id: string;
  room_id: string;
  user_id: string;
  draft_content: string;
  verdict: "approve" | "revise";
  violated_rules: string[] | null;
  explanation: string | null;
  model: string;
  latency_ms: number | null;
  created_at: string;
};

export type ModeratorVerdict = {
  verdict: "approve" | "revise";
  violated_rules: string[];
  explanation: string;
  suggested_revision?: string;
  proposed_fact_updates: string[];
};

export type PushSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
};

export type RoomWithDetails = Room & {
  other_user_display_name: string | null;
  last_message_content: string | null;
  last_message_at: string | null;
  has_unread: boolean;
};
