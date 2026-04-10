"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SideChatPanel } from "@/components/SideChatPanel";
import {
  submitDraft,
  abandonDraft,
  type SubmitDraftResult,
} from "@/app/room/[roomId]/actions";
import type { SideChatMessage } from "@/lib/types";

type ComposerMode =
  | { type: "normal" }
  | {
      type: "side-chat";
      draftSessionId: string;
      rejectionCount: number;
      suggestedRevision?: string;
      messages: SideChatMessage[];
    };

export function Composer({ roomId }: { roomId: string }) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ComposerMode>({ type: "normal" });
  const [isModerating, setIsModerating] = useState(false);

  const handleSubmit = async (content: string, existingSessionId?: string) => {
    if (!content.trim()) return;

    setIsModerating(true);

    const result: SubmitDraftResult = await submitDraft(
      roomId,
      content.trim(),
      existingSessionId
    );

    setIsModerating(false);

    if (result.status === "approved") {
      setMode({ type: "normal" });
      setInput("");
    } else if (result.status === "revise") {
      setMode({
        type: "side-chat",
        draftSessionId: result.draftSessionId,
        rejectionCount: result.rejectionCount,
        suggestedRevision: result.suggestedRevision,
        messages: [],
      });
    } else {
      console.error("Submit draft error:", result.message);
      setMode({ type: "normal" });
    }
  };

  const handleAbandon = async () => {
    await abandonDraft(roomId);
    setMode({ type: "normal" });
    setInput("");
  };

  const handleNormalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSubmit(input);
  };

  if (mode.type === "side-chat") {
    return (
      <SideChatPanel
        roomId={roomId}
        draftSessionId={mode.draftSessionId}
        rejectionCount={mode.rejectionCount}
        suggestedRevision={mode.suggestedRevision}
        initialMessages={mode.messages}
        onSubmitRevision={(content) =>
          handleSubmit(content, mode.draftSessionId)
        }
        onAbandon={handleAbandon}
      />
    );
  }

  return (
    <form onSubmit={handleNormalSubmit} className="p-4 border-t flex gap-2">
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type your message..."
        disabled={isModerating}
        className="flex-1"
      />
      <Button type="submit" disabled={isModerating || !input.trim()}>
        {isModerating ? "Moderating..." : "Send"}
      </Button>
    </form>
  );
}
