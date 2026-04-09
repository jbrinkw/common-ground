"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SideChatMessage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

const MAX_REJECTIONS = 5;

export function SideChatPanel({
  roomId,
  userId,
  draftSessionId,
  rejectionCount,
  suggestedRevision,
  initialMessages,
  onSubmitRevision,
  onAbandon,
}: {
  roomId: string;
  userId: string;
  draftSessionId: string;
  rejectionCount: number;
  suggestedRevision?: string;
  initialMessages: SideChatMessage[];
  onSubmitRevision: (content: string) => void;
  onAbandon: () => void;
}) {
  const [messages, setMessages] = useState<SideChatMessage[]>(initialMessages);
  const [input, setInput] = useState(suggestedRevision ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`side_chat:${roomId}:${userId}:${draftSessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "side_chat_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const msg = payload.new as SideChatMessage;
          if (
            msg.user_id === userId &&
            msg.draft_session_id === draftSessionId
          ) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, userId, draftSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isSubmitting) return;
    setIsSubmitting(true);
    onSubmitRevision(input.trim());
    setInput("");
    setIsSubmitting(false);
  };

  const atMaxRejections = rejectionCount >= MAX_REJECTIONS;

  return (
    <div className="border-t bg-card flex flex-col">
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Revise Your Message</span>
          <Badge variant="outline" className="text-xs">
            Attempt {rejectionCount}/{MAX_REJECTIONS}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onAbandon}>
          Abandon
        </Button>
      </div>

      <ScrollArea className="flex-1 max-h-60 p-4">
        <div className="space-y-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              <span className="text-xs text-muted-foreground mb-1">
                {msg.role === "ai" ? "Moderator" : "You"}
              </span>
              <div
                className={`rounded-lg px-3 py-2 max-w-[85%] text-sm ${
                  msg.role === "ai"
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {atMaxRejections ? (
        <div className="p-4 text-center">
          <p className="text-sm text-muted-foreground mb-2">
            You have reached the maximum number of revision attempts. Consider
            taking a break and approaching this point differently.
          </p>
          <Button variant="outline" onClick={onAbandon}>
            Close
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="p-3 border-t flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your revised message..."
            disabled={isSubmitting}
            className="flex-1"
          />
          <Button type="submit" disabled={isSubmitting || !input.trim()}>
            Submit Revision
          </Button>
        </form>
      )}
    </div>
  );
}
