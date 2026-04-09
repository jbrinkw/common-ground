"use server";

import { moderateMessage } from "@/lib/moderator";
import { mockStore } from "@/lib/mock-store";
import { v4 as uuidv4 } from "uuid";
import type { ModeratorVerdict } from "@/lib/types";

const isSupabaseConfigured = () =>
  !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function getSupabase() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient();
}

export type SubmitDraftResult =
  | {
      status: "approved";
      messageId: string;
    }
  | {
      status: "revise";
      explanation: string;
      suggestedRevision?: string;
      rejectionCount: number;
      draftSessionId: string;
    }
  | {
      status: "error";
      message: string;
    };

// ─── Mock implementations (no Supabase) ────────────────────────────

async function submitDraftMock(
  roomId: string,
  userId: string,
  content: string,
  existingDraftSessionId?: string
): Promise<SubmitDraftResult> {
  const draftSessionId = existingDraftSessionId ?? uuidv4();

  // Gather context from mock store
  const mainMessages = mockStore.getRecentMainMessages(roomId, 20);
  const facts = mockStore.getFacts(roomId).map((f) => f.content);
  let sideChatHistory: Array<{ role: "user" | "ai"; content: string }> = [];

  if (existingDraftSessionId) {
    sideChatHistory = mockStore
      .getSideChatMessages(roomId, userId, existingDraftSessionId)
      .map((m) => ({ role: m.role, content: m.content }));
  }

  // Call moderator (will use mock when no API key)
  const verdict: ModeratorVerdict = await moderateMessage({
    draft: content,
    recentMainMessages: mainMessages,
    establishedFacts: facts,
    sideChatHistory: sideChatHistory.length > 0 ? sideChatHistory : undefined,
    rubricId: "default_v1",
  });

  const existingDraft = mockStore.getPendingDraft(roomId, userId);
  const currentRejectionCount = existingDraft?.rejection_count ?? 0;

  if (verdict.verdict === "approve") {
    const newMessage = mockStore.insertMainMessage(
      roomId,
      userId,
      content,
      currentRejectionCount
    );

    for (const fact of verdict.proposed_fact_updates) {
      mockStore.insertFact(roomId, fact, newMessage.id);
    }

    mockStore.deletePendingDraft(roomId, userId);
    return { status: "approved", messageId: newMessage.id };
  } else {
    const newRejectionCount = currentRejectionCount + 1;

    mockStore.upsertPendingDraft(
      roomId,
      userId,
      content,
      newRejectionCount,
      draftSessionId
    );

    // Record user's draft in side-chat
    mockStore.insertSideChatMessage(
      roomId,
      userId,
      "user",
      content,
      draftSessionId
    );

    // Record AI's explanation in side-chat
    mockStore.insertSideChatMessage(
      roomId,
      userId,
      "ai",
      verdict.explanation,
      draftSessionId
    );

    return {
      status: "revise",
      explanation: verdict.explanation,
      suggestedRevision: verdict.suggested_revision,
      rejectionCount: newRejectionCount,
      draftSessionId,
    };
  }
}

// ─── Supabase implementations ──────────────────────────────────────

async function submitDraftSupabase(
  roomId: string,
  userId: string,
  content: string,
  existingDraftSessionId?: string
): Promise<SubmitDraftResult> {
  const supabase = await getSupabase();

  // Load recent main messages for context
  const { data: recentMessages } = await supabase
    .from("main_messages")
    .select("sender_id, content")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(20);

  const mainMessages = (recentMessages ?? [])
    .reverse()
    .map((m) => ({
      sender: m.sender_id,
      content: m.content,
    }));

  // Load established facts
  const { data: facts } = await supabase
    .from("established_facts")
    .select("content")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });

  const establishedFacts = (facts ?? []).map((f) => f.content);

  // Load side-chat history if this is a revision
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

  // Call moderator
  const startTime = Date.now();
  const verdict: ModeratorVerdict = await moderateMessage({
    draft: content,
    recentMainMessages: mainMessages,
    establishedFacts,
    sideChatHistory:
      sideChatHistory.length > 0 ? sideChatHistory : undefined,
    rubricId: "default_v1",
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
    model: "claude-sonnet-4-6-20250514",
    latency_ms: latencyMs,
  });

  if (verdict.verdict === "approve") {
    // Insert approved message into main thread
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

    // Insert any proposed fact updates
    if (verdict.proposed_fact_updates.length > 0) {
      const factInserts = verdict.proposed_fact_updates.map((fact) => ({
        room_id: roomId,
        content: fact,
        established_by_message_id: newMessage.id,
      }));
      await supabase.from("established_facts").insert(factInserts);
    }

    // Clean up pending draft
    await supabase
      .from("pending_drafts")
      .delete()
      .eq("room_id", roomId)
      .eq("user_id", userId);

    return { status: "approved", messageId: newMessage.id };
  } else {
    // Verdict is "revise"
    const newRejectionCount = currentRejectionCount + 1;

    // Upsert pending draft
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

    // Record the user's draft attempt in side-chat
    await supabase.from("side_chat_messages").insert({
      room_id: roomId,
      user_id: userId,
      role: "user",
      content,
      draft_session_id: draftSessionId,
    });

    // Insert AI's explanation into side-chat
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
}

// ─── Public API (dispatches to mock or Supabase) ───────────────────

export async function submitDraft(
  roomId: string,
  userId: string,
  content: string,
  existingDraftSessionId?: string
): Promise<SubmitDraftResult> {
  try {
    if (isSupabaseConfigured()) {
      return await submitDraftSupabase(
        roomId,
        userId,
        content,
        existingDraftSessionId
      );
    }
    return await submitDraftMock(
      roomId,
      userId,
      content,
      existingDraftSessionId
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unknown error occurred";
    return { status: "error", message };
  }
}

export async function abandonDraft(
  roomId: string,
  userId: string
): Promise<{ success: boolean }> {
  try {
    if (isSupabaseConfigured()) {
      const supabase = await getSupabase();
      await supabase
        .from("pending_drafts")
        .delete()
        .eq("room_id", roomId)
        .eq("user_id", userId);
    } else {
      mockStore.deletePendingDraft(roomId, userId);
    }
    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function createRoom(): Promise<
  { roomId: string } | { error: string }
> {
  try {
    if (isSupabaseConfigured()) {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from("rooms")
        .insert({ user_a_id: "A", user_b_id: "B" })
        .select("id")
        .single();
      if (error) throw error;
      return { roomId: data.id };
    } else {
      const room = mockStore.createRoom("A", "B");
      return { roomId: room.id };
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create room";
    return { error: message };
  }
}

/** Fetch room data for the room page (mock mode only). */
export async function getRoomData(roomId: string) {
  if (isSupabaseConfigured()) {
    return null; // Client fetches from Supabase directly
  }
  return {
    messages: mockStore.getMainMessages(roomId),
    facts: mockStore.getFacts(roomId),
  };
}
