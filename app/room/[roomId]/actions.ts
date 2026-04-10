"use server";

import { moderateMessage } from "@/lib/moderator";
import { v4 as uuidv4 } from "uuid";
import type { ModeratorVerdict } from "@/lib/types";
import { notifyRoomParticipant } from "./push-actions";

async function getSupabase() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient();
}

async function getServiceSupabase() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getAuthUser() {
  const supabase = await getSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");
  return { supabase, user };
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export type SubmitDraftResult =
  | { status: "approved"; messageId: string }
  | {
      status: "revise";
      explanation: string;
      suggestedRevision?: string;
      rejectionCount: number;
      draftSessionId: string;
    }
  | { status: "error"; message: string };

export async function submitDraft(
  roomId: string,
  content: string,
  existingDraftSessionId?: string
): Promise<SubmitDraftResult> {
  try {
    const { supabase, user } = await getAuthUser();
    const userId = user.id;

    // Verify user is a participant
    const { data: room } = await supabase
      .from("rooms")
      .select("id, topic")
      .eq("id", roomId)
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .single();

    if (!room) throw new Error("Not a participant of this room");

    // Load context
    const { data: recentMessages } = await supabase
      .from("main_messages")
      .select("sender_id, content")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(20);

    const mainMessages = (recentMessages ?? [])
      .reverse()
      .map((m) => ({ sender: m.sender_id, content: m.content }));

    const { data: facts } = await supabase
      .from("established_facts")
      .select("content")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true });

    const establishedFacts = (facts ?? []).map((f) => f.content);

    let sideChatHistory: Array<{ role: "user" | "ai"; content: string }> = [];
    const draftSessionId = existingDraftSessionId ?? uuidv4();

    if (existingDraftSessionId) {
      const { data: sideChat } = await supabase
        .from("side_chat_messages")
        .select("role, content")
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .eq("draft_session_id", existingDraftSessionId)
        .order("created_at", { ascending: true });

      sideChatHistory = (sideChat ?? []).map((m) => ({
        role: m.role as "user" | "ai",
        content: m.content,
      }));
    }

    // Moderate
    const startTime = Date.now();
    const verdict: ModeratorVerdict = await moderateMessage({
      draft: content,
      recentMainMessages: mainMessages,
      establishedFacts,
      sideChatHistory: sideChatHistory.length > 0 ? sideChatHistory : undefined,
      rubricId: "default_v1",
      topic: room.topic ?? undefined,
    });
    const latencyMs = Date.now() - startTime;

    // Get current rejection count
    const { data: existingDraft } = await supabase
      .from("pending_drafts")
      .select("rejection_count")
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .single();

    const currentRejectionCount = existingDraft?.rejection_count ?? 0;

    // Log moderation decision
    await supabase.from("moderation_decisions").insert({
      room_id: roomId,
      user_id: userId,
      draft_content: content,
      verdict: verdict.verdict,
      violated_rules: verdict.violated_rules,
      explanation: verdict.explanation,
      model: "claude-haiku-4-5-20251001",
      latency_ms: latencyMs,
    });

    if (verdict.verdict === "approve") {
      const { data: newMessage, error: insertError } = await supabase
        .from("main_messages")
        .insert({
          room_id: roomId,
          sender_id: userId,
          content,
          revision_count: currentRejectionCount,
        })
        .select("id")
        .single();

      if (insertError || !newMessage) {
        throw insertError ?? new Error("Failed to insert message");
      }

      if (verdict.proposed_fact_updates.length > 0) {
        const factInserts = verdict.proposed_fact_updates.map((fact) => ({
          room_id: roomId,
          content: fact,
          established_by_message_id: newMessage.id,
        }));
        await supabase.from("established_facts").insert(factInserts);
      }

      await supabase
        .from("pending_drafts")
        .delete()
        .eq("room_id", roomId)
        .eq("user_id", userId);

      // Send push notification to the other participant (fire and forget)
      notifyRoomParticipant(roomId, userId, content).catch(() => {});

      return { status: "approved", messageId: newMessage.id };
    } else {
      const newRejectionCount = currentRejectionCount + 1;

      await supabase.from("pending_drafts").upsert(
        {
          room_id: roomId,
          user_id: userId,
          current_content: content,
          rejection_count: newRejectionCount,
          draft_session_id: draftSessionId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id,user_id" }
      );

      await supabase.from("side_chat_messages").insert({
        room_id: roomId,
        user_id: userId,
        role: "user",
        content,
        draft_session_id: draftSessionId,
      });

      await supabase.from("side_chat_messages").insert({
        room_id: roomId,
        user_id: userId,
        role: "ai",
        content: verdict.explanation,
        draft_session_id: draftSessionId,
      });

      return {
        status: "revise",
        explanation: verdict.explanation,
        suggestedRevision: verdict.suggested_revision,
        rejectionCount: newRejectionCount,
        draftSessionId,
      };
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unknown error occurred";
    return { status: "error", message };
  }
}

export async function forceSendDraft(
  roomId: string,
  content: string
): Promise<{ status: "approved"; messageId: string } | { status: "error"; message: string }> {
  try {
    const { supabase, user } = await getAuthUser();
    const userId = user.id;

    // Verify participant
    const { data: room } = await supabase
      .from("rooms")
      .select("id")
      .eq("id", roomId)
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .single();

    if (!room) throw new Error("Not a participant of this room");

    // Insert the original message content (no moderator note visible to recipient)
    const { data: newMessage, error: insertError } = await supabase
      .from("main_messages")
      .insert({
        room_id: roomId,
        sender_id: userId,
        content,
        revision_count: -1, // negative signals force-sent
      })
      .select("id")
      .single();

    if (insertError || !newMessage) {
      throw insertError ?? new Error("Failed to insert message");
    }

    // Clean up pending draft
    await supabase
      .from("pending_drafts")
      .delete()
      .eq("room_id", roomId)
      .eq("user_id", userId);

    // Push notification
    notifyRoomParticipant(roomId, userId, content).catch(() => {});

    return { status: "approved", messageId: newMessage.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to force send";
    return { status: "error", message };
  }
}

export async function abandonDraft(roomId: string): Promise<{ success: boolean }> {
  try {
    const { supabase, user } = await getAuthUser();
    await supabase
      .from("pending_drafts")
      .delete()
      .eq("room_id", roomId)
      .eq("user_id", user.id);
    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function createRoom(topic?: string): Promise<
  { roomId: string; inviteCode: string; inviteToken: string } | { error: string }
> {
  try {
    const { supabase, user } = await getAuthUser();
    const inviteCode = generateInviteCode();

    const { data, error } = await supabase
      .from("rooms")
      .insert({
        user_a_id: user.id,
        invite_code: inviteCode,
        ...(topic ? { topic } : {}),
      })
      .select("id, invite_code, invite_token")
      .single();

    if (error) throw error;
    return {
      roomId: data.id,
      inviteCode: data.invite_code,
      inviteToken: data.invite_token,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create room";
    return { error: message };
  }
}

export async function joinRoomByCode(
  code: string
): Promise<{ roomId: string } | { error: string }> {
  try {
    const { user } = await getAuthUser();
    // Use service role to bypass RLS — joiner isn't a participant yet
    const admin = await getServiceSupabase();

    const { data: room, error: findError } = await admin
      .from("rooms")
      .select("id, user_a_id, user_b_id")
      .eq("invite_code", code.toUpperCase())
      .single();

    if (findError || !room) return { error: "Room not found" };
    if (room.user_a_id === user.id) return { error: "You created this room" };
    if (room.user_b_id !== null) return { error: "Room is already full" };

    const { error: updateError } = await admin
      .from("rooms")
      .update({ user_b_id: user.id })
      .eq("id", room.id);

    if (updateError) throw updateError;
    return { roomId: room.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to join room";
    return { error: message };
  }
}

export async function joinRoomByToken(
  token: string
): Promise<{ roomId: string } | { error: string }> {
  try {
    const { user } = await getAuthUser();
    const admin = await getServiceSupabase();

    const { data: room, error: findError } = await admin
      .from("rooms")
      .select("id, user_a_id, user_b_id")
      .eq("invite_token", token)
      .single();

    if (findError || !room) return { error: "Invalid invite link" };
    if (room.user_a_id === user.id) return { error: "You created this room" };
    if (room.user_b_id !== null) return { error: "Room is already full" };

    const { error: updateError } = await admin
      .from("rooms")
      .update({ user_b_id: user.id })
      .eq("id", room.id);

    if (updateError) throw updateError;
    return { roomId: room.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to join room";
    return { error: message };
  }
}

export async function getDashboardRooms() {
  const { supabase, user } = await getAuthUser();

  const { data: rooms, error } = await supabase
    .from("rooms")
    .select(`
      *,
      user_a_profile:profiles!rooms_user_a_id_fkey(display_name),
      user_b_profile:profiles!rooms_user_b_id_fkey(display_name)
    `)
    .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
    .order("created_at", { ascending: false });

  if (error) throw error;

  // Get latest message for each room
  const roomIds = (rooms ?? []).map((r) => r.id);
  const { data: latestMessages } = await supabase
    .from("main_messages")
    .select("room_id, content, created_at")
    .in("room_id", roomIds)
    .order("created_at", { ascending: false });

  const latestByRoom = new Map<string, { content: string; created_at: string }>();
  for (const msg of latestMessages ?? []) {
    if (!latestByRoom.has(msg.room_id)) {
      latestByRoom.set(msg.room_id, { content: msg.content, created_at: msg.created_at });
    }
  }

  return (rooms ?? []).map((room) => {
    const isUserA = room.user_a_id === user.id;
    const otherProfile = isUserA ? room.user_b_profile : room.user_a_profile;
    const latest = latestByRoom.get(room.id);

    return {
      ...room,
      other_user_display_name: otherProfile?.display_name ?? null,
      last_message_content: latest?.content ?? null,
      last_message_at: latest?.created_at ?? null,
    };
  });
}
