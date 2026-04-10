"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MainMessage, EstablishedFact } from "@/lib/types";
import Link from "next/link";
import { MainThread } from "@/components/MainThread";
import { FactsSidebar } from "@/components/FactsSidebar";
import { Composer } from "@/components/Composer";
import { TypingIndicator } from "@/components/TypingIndicator";
import { ConversationSummary } from "@/components/ConversationSummary";
import { markRoomVisited, archiveRoom } from "./actions";

export default function RoomPage() {
  const params = useParams();
  const roomId = params.roomId as string;

  const [userId, setUserId] = useState<string | null>(null);
  const [otherUserName, setOtherUserName] = useState<string>("...");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<MainMessage[]>([]);
  const [facts, setFacts] = useState<EstablishedFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roomTopic, setRoomTopic] = useState<string | null>(null);
  const [showFacts, setShowFacts] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const supabase = createClient();

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("Not authenticated");
        return;
      }
      setUserId(user.id);

      // Get room details with profiles
      const { data: room } = await supabase
        .from("rooms")
        .select(`
          *,
          user_a_profile:profiles!rooms_user_a_id_fkey(display_name),
          user_b_profile:profiles!rooms_user_b_id_fkey(display_name)
        `)
        .eq("id", roomId)
        .single();

      if (!room) {
        setError("Room not found or access denied");
        return;
      }

      const isUserA = room.user_a_id === user.id;
      const otherProfile = isUserA ? room.user_b_profile : room.user_a_profile;
      setOtherUserName(otherProfile?.display_name ?? "Waiting for partner...");
      setRoomTopic(room.topic ?? null);

      if (!otherProfile?.display_name) {
        setInviteCode(room.invite_code ?? null);
        setInviteToken(room.invite_token ?? null);
      }

      // Load messages and facts
      const [messagesResult, factsResult] = await Promise.all([
        supabase
          .from("main_messages")
          .select("*")
          .eq("room_id", roomId)
          .order("created_at", { ascending: true }),
        supabase
          .from("established_facts")
          .select("*")
          .eq("room_id", roomId)
          .order("created_at", { ascending: true }),
      ]);

      if (messagesResult.error) throw messagesResult.error;
      if (factsResult.error) throw factsResult.error;

      setMessages(messagesResult.data ?? []);
      setFacts(factsResult.data ?? []);

      // Mark room as visited (fire and forget)
      markRoomVisited(roomId).catch(() => {});
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load room data";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Register push notifications on first visit
  useEffect(() => {
    import("@/lib/push-client").then(({ registerPushSubscription }) => {
      registerPushSubscription().catch(console.error);
    });
  }, []);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="text-muted-foreground">Loading room...</p>
      </div>
    );
  }

  if (error || !userId) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-2">Error</p>
          <p className="text-sm text-muted-foreground">{error ?? "Not authenticated"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh flex overflow-hidden">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b p-3 sm:p-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Link href="/" className="min-h-[44px] min-w-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </Link>
            <div>
              <h1 className="font-semibold text-sm sm:text-base">CommonGround</h1>
              <p className="text-xs text-muted-foreground truncate max-w-[200px] sm:max-w-none">
                Talking with {otherUserName}
                {roomTopic && <span className="ml-1">— {roomTopic}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ConversationSummary roomId={roomId} />
            <button
              className="text-xs text-muted-foreground hover:text-foreground min-h-[44px] px-2 transition-colors"
              onClick={async () => {
                if (confirm("Archive this conversation?")) {
                  await archiveRoom(roomId);
                  window.location.href = "/";
                }
              }}
            >
              Archive
            </button>
            <button
              className="md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center text-sm text-muted-foreground"
              onClick={() => setShowFacts(!showFacts)}
            >
              Facts ({facts.length})
            </button>
          </div>
        </div>

        {/* Waiting for partner banner */}
        {otherUserName === "Waiting for partner..." && inviteCode && (
          <div className="mx-4 mt-4 p-4 rounded-lg border bg-muted/50 text-center space-y-2">
            <p className="text-sm font-medium">Share this room with your discussion partner</p>
            <p className="text-xs text-muted-foreground">
              Invite code: <span className="font-mono font-semibold text-foreground">{inviteCode}</span>
            </p>
            {inviteToken && (
              <button
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                onClick={async () => {
                  const url = `${window.location.origin}/join/${inviteToken}`;
                  await navigator.clipboard.writeText(url);
                  setLinkCopied(true);
                  setTimeout(() => setLinkCopied(false), 2000);
                }}
              >
                {linkCopied ? "Link copied!" : "Copy invite link"}
              </button>
            )}
          </div>
        )}

        {/* Messages */}
        <MainThread
          roomId={roomId}
          currentUserId={userId}
          initialMessages={messages}
        />

        {/* Typing indicator */}
        <TypingIndicator roomId={roomId} currentUserId={userId} otherUserName={otherUserName} />

        {/* Composer */}
        <Composer roomId={roomId} userId={userId} />
      </div>

      {/* Facts sidebar — desktop inline, mobile overlay */}
      {showFacts && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setShowFacts(false)}
        />
      )}
      <div className={`
        ${showFacts ? "fixed inset-y-0 right-0 z-50 w-72 shadow-xl" : "hidden"}
        md:relative md:block md:w-72 md:shadow-none md:z-auto
      `}>
        <FactsSidebar roomId={roomId} initialFacts={facts} />
      </div>
    </div>
  );
}
