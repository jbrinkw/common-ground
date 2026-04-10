import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getDashboardRooms } from "@/app/room/[roomId]/actions";
import { RoomCard } from "@/components/RoomCard";
import { CreateRoomDialog } from "@/components/CreateRoomDialog";
import { JoinRoomForm } from "@/components/JoinRoomForm";
import { UserGuide } from "@/components/UserGuide";
import { SignOutButton } from "@/components/SignOutButton";
import type { RoomWithDetails } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  let rooms: RoomWithDetails[] = [];
  try {
    rooms = await getDashboardRooms();
  } catch {
    // Will show empty state
  }

  return (
    <div className="min-h-dvh p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold">CommonGround</h1>
          <p className="text-sm text-muted-foreground">Your conversations</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <UserGuide />
          <JoinRoomForm />
          <CreateRoomDialog />
          <SignOutButton />
        </div>
      </div>

      {rooms.length === 0 ? (
        <div className="max-w-md mx-auto text-center py-16">
          <div className="w-16 h-16 rounded-full bg-[#2d8282]/10 flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-[#2d8282]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold mb-2">Start a conversation</h2>
          <p className="text-muted-foreground mb-6">
            Create a room and invite someone to discuss a topic. Every message
            is moderated by AI to keep things productive.
          </p>
          <div className="flex flex-col gap-3 items-center">
            <CreateRoomDialog />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>or</span>
              <JoinRoomForm />
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms.map((room) => (
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
      )}
    </div>
  );
}
