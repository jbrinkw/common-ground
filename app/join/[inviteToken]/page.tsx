import { redirect } from "next/navigation";
import { joinRoomByToken } from "@/app/room/[roomId]/actions";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ inviteToken: string }>;
}) {
  const { inviteToken } = await params;

  const result = await joinRoomByToken(inviteToken);

  if ("error" in result) {
    redirect(`/?joinError=${encodeURIComponent(result.error)}`);
  }

  redirect(`/room/${result.roomId}`);
}
