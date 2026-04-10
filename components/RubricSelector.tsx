"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { proposeRubricChange, respondToRubricProposal } from "@/app/room/[roomId]/actions";

const RUBRIC_OPTIONS = [
  {
    id: "minimal_v1",
    label: "Minimal",
    description: "Blocks threats and slurs only",
  },
  {
    id: "gentle_v1",
    label: "Gentle",
    description: "Blocks insults, slurs, and misrepresentation",
  },
  {
    id: "default_v1",
    label: "Default",
    description: "Same as Gentle (standard moderation)",
  },
  {
    id: "strict_v1",
    label: "Strict",
    description: "Also blocks profanity, sarcasm, and passive-aggression",
  },
];

function getRubricLabel(rubricId: string): string {
  return RUBRIC_OPTIONS.find((r) => r.id === rubricId)?.label ?? rubricId;
}

function getBadgeStyle(rubricId: string): string {
  switch (rubricId) {
    case "strict_v1":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "minimal_v1":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

interface RubricProposal {
  id: string;
  room_id: string;
  proposed_by: string;
  rubric_id: string;
  status: string;
  created_at: string;
}

interface RubricSelectorProps {
  roomId: string;
  currentUserId: string;
  currentRubricId: string;
  onRubricChange?: (newRubricId: string) => void;
}

export function RubricSelector({
  roomId,
  currentUserId,
  currentRubricId,
  onRubricChange,
}: RubricSelectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<RubricProposal | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeRubricId, setActiveRubricId] = useState(currentRubricId);

  useEffect(() => {
    setActiveRubricId(currentRubricId);
  }, [currentRubricId]);

  // Fetch any pending proposals for this room
  useEffect(() => {
    const supabase = createClient();

    async function loadPendingProposal() {
      const { data } = await supabase
        .from("rubric_proposals")
        .select("*")
        .eq("room_id", roomId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      setPendingProposal(data ?? null);
    }

    loadPendingProposal();

    // Subscribe to realtime updates on rubric_proposals
    const channel = supabase
      .channel(`rubric_proposals:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rubric_proposals",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const proposal = payload.new as RubricProposal;
            if (proposal.status === "pending") {
              setPendingProposal(proposal);
            }
          } else if (payload.eventType === "UPDATE") {
            const proposal = payload.new as RubricProposal;
            if (proposal.status !== "pending") {
              setPendingProposal((prev) =>
                prev?.id === proposal.id ? null : prev
              );
              // If accepted, update the displayed rubric
              if (proposal.status === "accepted") {
                setActiveRubricId(proposal.rubric_id);
                onRubricChange?.(proposal.rubric_id);
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, onRubricChange]);

  async function handlePropose(rubricId: string) {
    setShowDropdown(false);
    if (rubricId === activeRubricId) return;
    setIsSubmitting(true);
    try {
      const result = await proposeRubricChange(roomId, rubricId);
      if ("error" in result) {
        console.error("Failed to propose rubric change:", result.error);
      }
      // The realtime subscription will update pendingProposal
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRespond(accept: boolean) {
    if (!pendingProposal) return;
    setIsSubmitting(true);
    try {
      const result = await respondToRubricProposal(pendingProposal.id, accept);
      if ("error" in result) {
        console.error("Failed to respond to proposal:", result.error);
      }
      // Realtime will clear the proposal; if accepted, rubric updates too
    } finally {
      setIsSubmitting(false);
    }
  }

  const isIncomingProposal: RubricProposal | null =
    pendingProposal && pendingProposal.proposed_by !== currentUserId ? pendingProposal : null;
  const isOutgoingProposal: RubricProposal | null =
    pendingProposal && pendingProposal.proposed_by === currentUserId ? pendingProposal : null;

  return (
    <div className="relative flex items-center gap-1">
      {/* Incoming proposal banner */}
      {isIncomingProposal && (
        <div className="flex items-center gap-1.5 text-xs bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md px-2 py-1">
          <span className="text-yellow-800 dark:text-yellow-200">
            Switch to <strong>{getRubricLabel(isIncomingProposal.rubric_id)}</strong> mode?
          </span>
          <button
            disabled={isSubmitting}
            onClick={() => handleRespond(true)}
            className="text-green-700 dark:text-green-400 font-medium hover:underline disabled:opacity-50"
          >
            Accept
          </button>
          <button
            disabled={isSubmitting}
            onClick={() => handleRespond(false)}
            className="text-red-700 dark:text-red-400 font-medium hover:underline disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      )}

      {/* Outgoing proposal indicator */}
      {isOutgoingProposal && (
        <span className="text-xs text-muted-foreground italic">
          Waiting for {getRubricLabel(isOutgoingProposal.rubric_id)} approval…
        </span>
      )}

      {/* Current mode badge + dropdown trigger */}
      {!isIncomingProposal && !isOutgoingProposal && (
        <button
          onClick={() => setShowDropdown((v) => !v)}
          disabled={isSubmitting}
          className={`
            text-xs font-medium rounded-full px-2 py-0.5 transition-opacity
            hover:opacity-80 disabled:opacity-50 cursor-pointer
            ${getBadgeStyle(activeRubricId)}
          `}
          title="Change moderation mode"
        >
          {getRubricLabel(activeRubricId)}
        </button>
      )}

      {/* Dropdown */}
      {showDropdown && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowDropdown(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-20 w-64 rounded-md border bg-popover shadow-md p-1">
            <p className="text-xs text-muted-foreground px-2 py-1 font-medium">
              Propose moderation mode
            </p>
            {RUBRIC_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => handlePropose(option.id)}
                className={`
                  w-full text-left px-2 py-1.5 rounded text-sm hover:bg-accent transition-colors
                  ${option.id === activeRubricId ? "font-semibold" : ""}
                `}
              >
                <span className="block">{option.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {option.description}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
