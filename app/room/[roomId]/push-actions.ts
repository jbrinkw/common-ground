"use server";

import { sendPushNotification } from "@/lib/push";

async function getSupabase() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient();
}

async function getServiceSupabase() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
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
  // Use service role to read other user's push subscriptions
  const admin = await getServiceSupabase();

  // Find the other participant
  const { data: room } = await admin
    .from("rooms")
    .select("user_a_id, user_b_id")
    .eq("id", roomId)
    .single();

  if (!room) return;

  const recipientId =
    room.user_a_id === senderUserId ? room.user_b_id : room.user_a_id;
  if (!recipientId) return;

  // Get sender's display name
  const { data: senderProfile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", senderUserId)
    .single();

  const senderName = senderProfile?.display_name ?? "Someone";

  // Get recipient's push subscriptions
  const { data: subscriptions } = await admin
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
      await admin.from("push_subscriptions").delete().eq("id", sub.id);
    }
  }
}
