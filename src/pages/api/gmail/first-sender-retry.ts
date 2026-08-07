import type { APIRoute } from "astro";
import { getSupabase } from "../../../lib/supabase";
import { deliverFirstSenderNotification, type FirstSenderEvent } from "../../../lib/firstSender";
import { env } from "../../../lib/env";

interface RetryRow extends FirstSenderEvent {
  emails: {
    thread_id: string;
    sender: string;
    subject: string | null;
    snippet: string | null;
    received_at: string;
    category: string | null;
    labels: string[] | null;
  } | null;
}

export const GET: APIRoute = async ({ request }) => {
  if (request.headers.get("authorization") !== `Bearer ${env("CRON_SECRET")}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("first_sender_events" as never)
    .select("sender_address, first_email_id, sender_display, first_received_at, source, notification_status, notification_attempts, last_notification_error, notified_at, emails!first_email_id(thread_id, sender, subject, snippet, received_at, category, labels)")
    .in("notification_status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) return new Response("Internal error", { status: 500 });

  let sent = 0;
  for (const row of (data ?? []) as RetryRow[]) {
    if (!row.emails) continue;
    const ok = await deliverFirstSenderNotification(supabase, row, {
      threadId: row.emails.thread_id,
      sender: row.emails.sender,
      senderAddress: row.sender_address,
      subject: row.emails.subject ?? "",
      snippet: row.emails.snippet ?? "",
      receivedAt: new Date(row.emails.received_at),
      category: row.emails.category ?? "uncategorized",
      labels: row.emails.labels ?? [],
    });
    if (ok) sent++;
  }
  return new Response(JSON.stringify({ status: "ok", attempted: (data ?? []).length, sent }), {
    headers: { "Content-Type": "application/json" },
  });
};
