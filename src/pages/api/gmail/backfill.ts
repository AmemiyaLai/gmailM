import type { APIRoute } from "astro";
import { getSupabase } from "../../../lib/supabase";
import { getPusher } from "../../../lib/pusher";
import { listMessages, getMessage } from "../../../lib/gmail";
import { classifyEmail } from "../../../lib/classify";

export const GET: APIRoute = async ({ request, url }) => {
  const authHeader = request.headers.get("authorization");
  const cronSecret = import.meta.env.CRON_SECRET;

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const maxResults = Math.min(
    1000,
    Number(url.searchParams.get("limit")) || 50,
  );

  const supabase = getSupabase();
  const pusher = getPusher();

  let imported = 0;
  let failed = 0;

  try {
    const messageIds = await listMessages(maxResults);

    for (const messageId of messageIds) {
      try {
        const gmailMsg = await getMessage(messageId);
        const category = classifyEmail({ sender: gmailMsg.sender, subject: gmailMsg.subject });

        const { error } = await supabase.from("emails" as never).upsert(
          {
            id: gmailMsg.id,
            thread_id: gmailMsg.threadId,
            sender: gmailMsg.sender,
            recipient: gmailMsg.recipient,
            subject: gmailMsg.subject,
            snippet: gmailMsg.snippet,
            body_html: gmailMsg.bodyHtml,
            body_plain: gmailMsg.bodyPlain,
            labels: gmailMsg.labels,
            received_at: gmailMsg.receivedAt.toISOString(),
            is_read: gmailMsg.isRead,
            category,
          } as never,
          { onConflict: "id" },
        );

        if (error) throw error;
        imported++;
      } catch (err) {
        console.error(`Failed to backfill message ${messageId}:`, err);
        failed++;
      }
    }

    await pusher.trigger("gmail-channel", "backfill-complete", { imported, failed });

    return new Response(
      JSON.stringify({ status: "ok", imported, failed, requested: maxResults }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Backfill failed:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
