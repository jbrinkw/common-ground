"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MainMessage, EstablishedFact } from "@/lib/types";
import { MainThread } from "@/components/MainThread";
import { FactsSidebar } from "@/components/FactsSidebar";
import { Composer } from "@/components/Composer";

export default function RoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const userId = searchParams.get("user") ?? "A";

  const [messages, setMessages] = useState<MainMessage[]>([]);
  const [facts, setFacts] = useState<EstablishedFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadInitialData() {
      try {
        const supabase = createClient();

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
    }

    loadInitialData();
  }, [roomId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading room...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-2">Error loading room</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <p className="text-xs text-muted-foreground mt-4">
            Make sure your Supabase environment variables are configured in
            .env.local
          </p>
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
              Room {roomId.slice(0, 8)}... &middot; You are User {userId}
            </p>
          </div>
        </div>

        {/* Messages */}
        <MainThread
          roomId={roomId}
          currentUserId={userId}
          initialMessages={messages}
        />

        {/* Composer */}
        <Composer roomId={roomId} userId={userId} />
      </div>

      {/* Facts sidebar */}
      <div className="w-72 hidden md:flex flex-col">
        <FactsSidebar roomId={roomId} initialFacts={facts} />
      </div>
    </div>
  );
}
