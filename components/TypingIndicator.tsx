"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function TypingIndicator({
  roomId,
  currentUserId,
  otherUserName,
}: {
  roomId: string;
  currentUserId: string;
  otherUserName: string;
}) {
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`typing:${roomId}`, {
      config: { presence: { key: currentUserId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const otherTyping = Object.entries(state).some(
          ([key, values]) =>
            key !== currentUserId &&
            (values as Array<{ typing?: boolean }>).some((v) => v.typing)
        );
        setIsTyping(otherTyping);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, currentUserId]);

  if (!isTyping) return null;

  return (
    <div className="px-4 py-1">
      <p className="text-xs text-muted-foreground animate-pulse">
        {otherUserName} is typing...
      </p>
    </div>
  );
}

// Export a hook for the Composer to broadcast typing state
export function useTypingBroadcast(roomId: string, userId: string) {
  const [channel, setChannel] = useState<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const ch = supabase.channel(`typing:${roomId}`, {
      config: { presence: { key: userId } },
    });
    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ typing: false });
      }
    });
    setChannel(ch);
    return () => {
      supabase.removeChannel(ch);
    };
  }, [roomId, userId]);

  const setTyping = (typing: boolean) => {
    channel?.track({ typing });
  };

  return { setTyping };
}
