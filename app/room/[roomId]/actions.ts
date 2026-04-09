"use server";

import { createClient } from "@/lib/supabase/server";
import { moderateMessage } from "@/lib/moderator";
import { v4 as uuidv4 } from "uuid";
import type { ModeratorVerdict } from "@/lib/types";

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

export async function submitDraft(
  roomId: string,
  userId: string,
  content: string,
  existingDraftSessionId?: string
): Promise<SubmitDraftResult> {
  try {
    const supabase = await createClient();

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

    const establishedFacts = (facts ?? []).map(
      (f) => f.content
    );

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
      const { data: newMessage } = await supabase
        .from("main_messages")
        .insert({
          room_id: roomId,
          sender_id: userId,
          content,
          revision_count: currentRejectionCount,
        })
        .select("id")
        .single();

      // Insert any proposed fact updates
      if (verdict.proposed_fact_updates.length > 0 && newMessage) {
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

      return { status: "approved", messageId: newMessage?.id ?? "" };
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
      if (existingDraftSessionId) {
        await supabase.from("side_chat_messages").insert({
          room_id: roomId,
          user_id: userId,
          role: "user",
          content,
          draft_session_id: draftSessionId,
        });
      }

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
    const supabase = await createClient();

    await supabase
      .from("pending_drafts")
      .delete()
      .eq("room_id", roomId)
      .eq("user_id", userId);

    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function createRoom(): Promise<{ roomId: string } | { error: string }> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("rooms")
      .insert({
        user_a_id: "A",
        user_b_id: "B",
      })
      .select("id")
      .single();

    if (error) throw error;

    return { roomId: data.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create room";
    return { error: message };
  }
}
