"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { generateSummary } from "@/app/room/[roomId]/summary-action";

export function ConversationSummary({ roomId }: { roomId: string }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);

    const result = await generateSummary(roomId);
    if ("error" in result) {
      setError(result.error);
    } else {
      setSummary(result.summary);
    }
    setLoading(false);
  };

  return (
    <>
      <button
        className="text-xs text-muted-foreground hover:text-foreground min-h-[44px] px-2 transition-colors"
        onClick={handleOpen}
      >
        Summary
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative bg-background rounded-xl border shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b flex items-center justify-between shrink-0">
              <h2 className="font-semibold text-xl">Conversation Summary</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <ScrollArea className="flex-1 p-6">
              {loading && (
                <p className="text-muted-foreground animate-pulse">Generating summary...</p>
              )}
              {error && <p className="text-destructive">{error}</p>}
              {summary && (
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                  {summary}
                </div>
              )}
            </ScrollArea>
            <div className="p-4 border-t shrink-0">
              <Button onClick={() => setOpen(false)} className="w-full">Close</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
