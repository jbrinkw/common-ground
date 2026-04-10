import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getDashboardRooms } from "@/app/room/[roomId]/actions";
import { RoomCard } from "@/components/RoomCard";
import { CreateRoomDialog } from "@/components/CreateRoomDialog";
import { JoinRoomForm } from "@/components/JoinRoomForm";
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
    <div className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">CommonGround</h1>
          <p className="text-sm text-muted-foreground">Your conversations</p>
        </div>
        <div className="flex items-center gap-3">
          <JoinRoomForm />
          <CreateRoomDialog />
        </div>
      </div>

      {rooms.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground mb-2">No rooms yet.</p>
          <p className="text-sm text-muted-foreground">
            Create a room or join one with an invite code.
          </p>
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
