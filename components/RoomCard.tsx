"use client";

import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { RoomWithDetails } from "@/lib/types";
import { deleteRoom } from "@/app/room/[roomId]/actions";

export function RoomCard({ room }: { room: RoomWithDetails }) {
  const router = useRouter();

  const timeAgo = room.last_message_at
    ? getTimeAgo(new Date(room.last_message_at))
    : getTimeAgo(new Date(room.created_at));

  return (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => router.push(`/room/${room.id}`)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {room.has_unread && (
              <div className="w-2.5 h-2.5 rounded-full bg-[#2d8282] flex-shrink-0" />
            )}
            <CardTitle className="text-base truncate">
              {room.other_user_display_name ?? "Waiting for someone to join..."}
            </CardTitle>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge variant={room.status === "active" ? "default" : "secondary"}>
              {room.status}
            </Badge>
            {!room.user_b_id && (
              <button
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (confirm("Delete this room?")) {
                    await deleteRoom(room.id);
                    router.refresh();
                  }
                }}
              >
                Delete
              </button>
            )}
          </div>
        </div>
        {room.topic && (
          <p className="text-xs text-muted-foreground mt-0.5">{room.topic}</p>
        )}
      </CardHeader>
      <CardContent>
        {room.last_message_content ? (
          <p className="text-sm text-muted-foreground truncate">
            {room.last_message_content}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic">No messages yet</p>
        )}
        <p className="text-xs text-muted-foreground mt-2">{timeAgo}</p>
      </CardContent>
    </Card>
  );
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
