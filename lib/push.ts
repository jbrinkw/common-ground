import webpush from "web-push";

webpush.setVapidDetails(
  "mailto:noreply@commonground.app",
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; url: string }
) {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(payload)
    );
  } catch (error: unknown) {
    // If subscription is expired/invalid, it will throw a 410 Gone
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 410 || statusCode === 404) {
      // Subscription is no longer valid — caller should clean up
      return { expired: true };
    }
    throw error;
  }
  return { expired: false };
}
