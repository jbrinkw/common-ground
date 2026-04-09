"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { MainMessage, EstablishedFact } from "@/lib/types";
import { MainThread } from "@/components/MainThread";
import { FactsSidebar } from "@/components/FactsSidebar";
import { Composer } from "@/components/Composer";
import { getRoomData } from "./actions";

const supabaseConfigured =
  typeof window !== "undefined" &&
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default function RoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const userId = searchParams.get("user") ?? "A";

  const [messages, setMessages] = useState<MainMessage[]>([]);
  const [facts, setFacts] = useState<EstablishedFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      if (supabaseConfigured) {
        // Use Supabase client directly
        const { createClient } = await import("@/lib/supabase/client");
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
      } else {
        // Use mock store via server action
        const data = await getRoomData(roomId);
        if (data) {
          setMessages(data.messages);
          setFacts(data.facts);
        }
      }
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

  // In mock mode, poll for updates since there's no Realtime
  useEffect(() => {
    if (supabaseConfigured) return;
    const interval = setInterval(loadData, 1000);
    return () => clearInterval(interval);
  }, [loadData]);

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
              {!supabaseConfigured && " (mock mode)"}
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
