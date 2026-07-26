import { sendFirstSenderDiscordNotification, type FirstSenderDiscordEmail } from "./discord";

export type FirstSenderSource = "baseline" | "live";
export type FirstSenderNotificationStatus = "baseline" | "pending" | "failed" | "sent";

export interface FirstSenderEvent {
  sender_address: string;
  first_email_id: string;
  sender_display: string;
  first_received_at: string;
  source: FirstSenderSource;
  notification_status: FirstSenderNotificationStatus;
  notification_attempts: number;
  last_notification_error: string | null;
  notified_at: string | null;
}

type SupabaseLike = { from: (table: string) => any };

export async function registerFirstSender(
  supabase: SupabaseLike,
  event: Pick<FirstSenderEvent, "sender_address" | "first_email_id" | "sender_display" | "first_received_at" | "source">,
): Promise<FirstSenderEvent | null> {
  const notificationStatus: FirstSenderNotificationStatus = event.source === "baseline" ? "baseline" : "pending";
  const { data, error } = await supabase
    .from("first_sender_events")
    .insert({ ...event, notification_status: notificationStatus } as never)
    .select("*")
    .single();

  // Postgres unique_violation 代表其他重複 Pub/Sub／並行請求已建立此首次事件。
  if (error) {
    if ((error as { code?: string }).code === "23505") return null;
    throw error;
  }
  return data as FirstSenderEvent;
}

export async function deliverFirstSenderNotification(
  supabase: SupabaseLike,
  event: FirstSenderEvent,
  email: FirstSenderDiscordEmail,
): Promise<boolean> {
  const attempts = event.notification_attempts + 1;
  try {
    await sendFirstSenderDiscordNotification(email);
    const { error } = await supabase.from("first_sender_events").update({
      notification_status: "sent",
      notification_attempts: attempts,
      last_notification_error: null,
      notified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never).eq("sender_address", event.sender_address);
    if (error) throw error;
    return true;
  } catch (error) {
    await supabase.from("first_sender_events").update({
      notification_status: "failed",
      notification_attempts: attempts,
      last_notification_error: error instanceof Error ? error.message : String(error),
      updated_at: new Date().toISOString(),
    } as never).eq("sender_address", event.sender_address);
    return false;
  }
}
