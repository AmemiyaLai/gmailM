import type { APIRoute } from "astro";
import { getSupabase } from "../../../lib/supabase";
import { summarizeUnreadEmails } from "../../../lib/gemini";
import { sendDiscordSummary } from "../../../lib/discord";
import { syncEmailsFromGmail } from "../../../lib/emailSync";

const SYNC_LIMIT = 50;

interface UnreadEmailRow {
  sender: string;
  subject: string;
  snippet: string;
  category: string | null;
  received_at: string;
}

function isQuietHours(): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
  return hour >= 1 && hour < 7;
}

export const GET: APIRoute = async ({ request }) => {
  const authHeader = request.headers.get("authorization");
  const cronSecret = import.meta.env.CRON_SECRET;

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  let syncResult = { imported: 0, failed: 0 };
  try {
    syncResult = await syncEmailsFromGmail(SYNC_LIMIT);
  } catch (err) {
    console.error("Hourly summary: Gmail sync failed:", err);
  }

  if (isQuietHours()) {
    return new Response(
      JSON.stringify({ status: "skipped", reason: "quiet hours", sync: syncResult }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = getSupabase();

  const { data, error } = (await supabase
    .from("emails" as never)
    .select("sender, subject, snippet, category, received_at")
    .eq("is_read", false)
    .order("received_at", { ascending: true })) as { data: UnreadEmailRow[] | null; error: unknown };

  if (error) {
    console.error("Hourly summary: failed to fetch unread emails:", error);
    return new Response("Internal error", { status: 500 });
  }

  const unread = data ?? [];

  if (unread.length === 0) {
    return new Response(
      JSON.stringify({ status: "skipped", reason: "no unread emails", sync: syncResult }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const periodStart = new Date(unread[0].received_at);
  const periodEnd = new Date(unread[unread.length - 1].received_at);

  const { data: lastSummary } = (await supabase
    .from("email_summaries" as never)
    .select("period_end")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { period_end: string } | null };

  if (lastSummary && periodEnd.getTime() <= new Date(lastSummary.period_end).getTime()) {
    return new Response(
      JSON.stringify({
        status: "skipped",
        reason: "no new unread emails since last summary",
        sync: syncResult,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const summaryText = await summarizeUnreadEmails(
      unread.map((e) => ({
        sender: e.sender,
        subject: e.subject,
        snippet: e.snippet,
        category: e.category,
        receivedAt: new Date(e.received_at),
      })),
    );

    const { error: insertError } = await supabase.from("email_summaries" as never).insert({
      summary_text: summaryText,
      email_count: unread.length,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
    } as never);

    if (insertError) {
      console.error("Hourly summary: failed to save summary row:", insertError);
    }

    await sendDiscordSummary({
      summaryText,
      emailCount: unread.length,
      periodStart,
      periodEnd,
    }).catch((err) => console.error("Hourly summary: Discord send failed:", err));

    return new Response(
      JSON.stringify({ status: "ok", emailCount: unread.length, sync: syncResult }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Hourly summary: Gemini summarization failed:", err);
    return new Response("Gemini summarization failed", { status: 502 });
  }
};
