"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MainMessage } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

export function MainThread({
  roomId,
  currentUserId,
  initialMessages,
}: {
  roomId: string;
  currentUserId: string;
  initialMessages: MainMessage[];
}) {
  const [messages, setMessages] = useState<MainMessage[]>(initialMessages);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`main_messages:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "main_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const newMessage = payload.new as MainMessage;
          setMessages((prev) => [...prev, newMessage]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <ScrollArea className="flex-1 p-4">
      <div className="space-y-4">
        {messages.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No messages yet. Start the conversation.
          </p>
        )}
        {messages.map((msg) => {
          const isOwnMessage = msg.sender_id === currentUserId;
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isOwnMessage ? "items-end" : "items-start"}`}
            >
              <span className="text-xs text-muted-foreground mb-1">
                {isOwnMessage ? "You" : "Them"}
              </span>
              <div
                className={`rounded-lg px-4 py-2 max-w-[85%] sm:max-w-[80%] ${
                  isOwnMessage
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.content}</p>
              </div>
              <div className="flex items-center gap-2 mt-1">
                {msg.revision_count > 0 && (
                  <Badge variant="outline" className="text-xs">
                    revised via moderator
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {new Date(msg.created_at).toLocaleTimeString()}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
