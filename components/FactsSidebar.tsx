"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EstablishedFact } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export function FactsSidebar({
  roomId,
  initialFacts,
}: {
  roomId: string;
  initialFacts: EstablishedFact[];
}) {
  const [facts, setFacts] = useState<EstablishedFact[]>(initialFacts);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`established_facts:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "established_facts",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const newFact = payload.new as EstablishedFact;
          setFacts((prev) => [...prev, newFact]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  return (
    <div className="border-l bg-card flex flex-col h-full">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="p-4 text-left font-semibold text-sm flex items-center justify-between hover:bg-accent transition-colors"
      >
        <span>Established Facts ({facts.length})</span>
        <span className="text-muted-foreground">
          {collapsed ? "+" : "-"}
        </span>
      </button>
      <Separator />
      {!collapsed && (
        <ScrollArea className="flex-1 p-4">
          {facts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No established facts yet. Facts will appear here as the
              conversation progresses and both parties agree on claims.
            </p>
          ) : (
            <ol className="space-y-2 list-decimal list-inside">
              {facts.map((fact) => (
                <li key={fact.id} className="text-sm">
                  {fact.content}
                </li>
              ))}
            </ol>
          )}
        </ScrollArea>
      )}
    </div>
  );
}
