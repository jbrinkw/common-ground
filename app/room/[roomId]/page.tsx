"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MainMessage, EstablishedFact } from "@/lib/types";
import { MainThread } from "@/components/MainThread";
import { FactsSidebar } from "@/components/FactsSidebar";
import { Composer } from "@/components/Composer";

export default function RoomPage() {
  const params = useParams();
  const roomId = params.roomId as string;

  const [userId, setUserId] = useState<string | null>(null);
  const [otherUserName, setOtherUserName] = useState<string>("...");
  const [messages, setMessages] = useState<MainMessage[]>([]);
  const [facts, setFacts] = useState<EstablishedFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFacts, setShowFacts] = useState(false);

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
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading room...</p>
      </div>
    );
  }

  if (error || !userId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-2">Error</p>
          <p className="text-sm text-muted-foreground">{error ?? "Not authenticated"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b p-4 flex items-center justify-between">
          <div>
            <h1 className="font-semibold">CommonGround</h1>
            <p className="text-xs text-muted-foreground">
              Talking with {otherUserName}
            </p>
          </div>
          <button
            className="md:hidden text-sm text-muted-foreground"
            onClick={() => setShowFacts(!showFacts)}
          >
            Facts ({facts.length})
          </button>
        </div>

        {/* Messages */}
        <MainThread
          roomId={roomId}
          currentUserId={userId}
          initialMessages={messages}
        />

        {/* Composer */}
        <Composer roomId={roomId} />
      </div>

      {/* Facts sidebar — desktop always, mobile toggle */}
      <div className={`w-72 flex-col ${showFacts ? "flex" : "hidden md:flex"}`}>
        <FactsSidebar roomId={roomId} initialFacts={facts} />
      </div>
    </div>
  );
}
