import {
  sendFirstSenderDigestNotification,
  sendFirstSenderDiscordNotification,
  type FirstSenderDiscordEmail,
} from "./discord";

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

/** Legacy retry endpoint 的相容函式；新通知一律由 sendFirstSenderDigest 處理。 */
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

export interface FirstSenderDigestResult {
  /** 本次摘要涵蓋的首次寄件者數（0 代表沒有新事件、未發送） */
  pending: number;
  sent: boolean;
}

type DigestRow = Pick<FirstSenderEvent, "sender_address" | "sender_display" | "first_received_at">;

/**
 * 彙整所有尚未通知（pending/failed）的首次寄件者，發送一則 Discord 摘要。
 * 由每日兩次的排程呼叫；沒有新事件時不發送任何訊息。
 */
export async function sendFirstSenderDigest(supabase: SupabaseLike): Promise<FirstSenderDigestResult> {
  const { data, error } = await supabase
    .from("first_sender_events")
    .select("sender_address, sender_display, first_received_at")
    .in("notification_status", ["pending", "failed"])
    .order("first_received_at", { ascending: true })
    .limit(200);
  if (error) throw error;

  const rows = (data ?? []) as DigestRow[];
  if (rows.length === 0) return { pending: 0, sent: false };

  const addresses = rows.map((row) => row.sender_address);

  try {
    await sendFirstSenderDigestNotification(rows.map((row) => ({
      senderAddress: row.sender_address,
      senderDisplay: row.sender_display,
      firstReceivedAt: row.first_received_at,
    })));
  } catch (sendError) {
    await supabase.from("first_sender_events").update({
      notification_status: "failed",
      last_notification_error: sendError instanceof Error ? sendError.message : String(sendError),
      updated_at: new Date().toISOString(),
    } as never).in("sender_address", addresses);
    return { pending: rows.length, sent: false };
  }

  // Discord 已成功送出：即使回寫失敗也不可標成 failed，否則下次摘要會重複通知同一批寄件者。
  const { error: updateError } = await supabase.from("first_sender_events").update({
    notification_status: "sent",
    last_notification_error: null,
    notified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as never).in("sender_address", addresses);
  if (updateError) {
    console.error("首次寄件者摘要已送出，但回寫 sent 狀態失敗：", updateError);
  }
  return { pending: rows.length, sent: true };
}
