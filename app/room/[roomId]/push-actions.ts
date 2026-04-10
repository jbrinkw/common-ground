"use server";

import { sendPushNotification } from "@/lib/push";

async function getSupabase() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient();
}

export async function savePushSubscription(subscription: {
  endpoint: string;
  p256dh: string;
  auth: string;
}) {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
    { onConflict: "user_id,endpoint" }
  );
}

export async function notifyRoomParticipant(
  roomId: string,
  senderUserId: string,
  messagePreview: string
) {
  const supabase = await getSupabase();

  // Find the other participant
  const { data: room } = await supabase
    .from("rooms")
    .select("user_a_id, user_b_id")
    .eq("id", roomId)
    .single();

  if (!room) return;

  const recipientId =
    room.user_a_id === senderUserId ? room.user_b_id : room.user_a_id;
  if (!recipientId) return;

  // Get sender's display name
  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", senderUserId)
    .single();

  const senderName = senderProfile?.display_name ?? "Someone";

  // Get recipient's push subscriptions
  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", recipientId);

  if (!subscriptions || subscriptions.length === 0) return;

  const preview =
    messagePreview.length > 100
      ? messagePreview.slice(0, 97) + "..."
      : messagePreview;

  for (const sub of subscriptions) {
    const result = await sendPushNotification(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      {
        title: "CommonGround",
        body: `${senderName}: ${preview}`,
        url: `/room/${roomId}`,
      }
    );

    if (result.expired) {
      await supabase.from("push_subscriptions").delete().eq("id", sub.id);
    }
  }
}
