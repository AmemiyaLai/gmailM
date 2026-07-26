import type { APIRoute } from "astro";
import { OAuth2Client } from "google-auth-library";
import { getSupabase } from "../../../lib/supabase";
import { getPusher } from "../../../lib/pusher";
import { listHistory, getMessage } from "../../../lib/gmail";
import { classifyEmail } from "../../../lib/classify";
import { sendDiscordNotification } from "../../../lib/discord";
import { judgeEmailImportance } from "../../../lib/gemini";
import { normalizeSenderAddress } from "../../../lib/senderAddress";
import { deliverFirstSenderNotification, registerFirstSender } from "../../../lib/firstSender";
import { refreshSenderTags } from "../../../lib/senderTagService";

interface SyncStateRow {
  watch_address: string;
  last_history_id: number;
}

const AUDIENCE = import.meta.env.PUBSUB_AUDIENCE;

async function verifyPubSubToken(
  token: string,
): Promise<boolean> {
  try {
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: AUDIENCE,
    });
    const payload = ticket.getPayload();
    if (!payload) return false;

    const serviceEmail = `service-${payload.azp}@${import.meta.env.GCP_PROJECT_ID}.iam.gserviceaccount.com`;
    return payload.email === serviceEmail;
  } catch {
    return false;
  }
}

export const POST: APIRoute = async ({ request }) => {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = authHeader.slice(7);
  const isValid = await verifyPubSubToken(token);
  if (!isValid) {
    return new Response("Invalid token", { status: 401 });
  }

  let body: { emailAddress?: string; historyId?: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { emailAddress, historyId } = body;
  if (!emailAddress || !historyId) {
    return new Response("Missing fields", { status: 400 });
  }

  const supabase = getSupabase();

  const { data: syncState } = await supabase
    .from("gmail_sync_state" as never)
    .select("last_history_id")
    .eq("watch_address", emailAddress)
    .single() as { data: SyncStateRow | null };

  const lastHistoryId = syncState?.last_history_id;

  if (!lastHistoryId) {
    await supabase.from("gmail_sync_state" as never).upsert({
      watch_address: emailAddress,
      last_history_id: Number(historyId),
      updated_at: new Date().toISOString(),
    } as never);
    return new Response("OK — initial baseline recorded", { status: 200 });
  }

  try {
    const { messages } = await listHistory(String(lastHistoryId));

    for (const { messageId } of messages) {
      try {
        const gmailMsg = await getMessage(messageId);
        const category = classifyEmail({ sender: gmailMsg.sender, subject: gmailMsg.subject });
        const senderAddress = normalizeSenderAddress(gmailMsg.sender);

        let important = gmailMsg.labels.includes("IMPORTANT"); // Gemini 失敗時的 fallback
        let importanceReason: string | undefined;
        try {
          const judged = await judgeEmailImportance({
            sender: gmailMsg.sender,
            subject: gmailMsg.subject,
            snippet: gmailMsg.snippet,
          });
          important = judged.important;
          importanceReason = judged.reason;
        } catch (err) {
          console.error(`Gemini importance judge failed for ${messageId}, falling back to IMPORTANT label:`, err);
        }

        const { error: emailUpsertError } = await supabase.from("emails" as never).upsert(
          {
            id: gmailMsg.id,
            thread_id: gmailMsg.threadId,
            sender: gmailMsg.sender,
            sender_address: senderAddress,
            recipient: gmailMsg.recipient,
            subject: gmailMsg.subject,
            snippet: gmailMsg.snippet,
            body_html: gmailMsg.bodyHtml,
            body_plain: gmailMsg.bodyPlain,
            labels: gmailMsg.labels,
            received_at: gmailMsg.receivedAt.toISOString(),
            is_read: gmailMsg.isRead,
            category,
            is_important: important,
            importance_reason: importanceReason ?? null,
          } as never,
          { onConflict: "id" },
        );
        if (emailUpsertError) throw emailUpsertError;

        if (important) {
          await sendDiscordNotification({ ...gmailMsg, category }).catch((err) =>
            console.error(`Failed to send Discord notification for ${messageId}:`, err),
          );
        }

        let isFirstSender = false;
        if (senderAddress) {
          const firstEvent = await registerFirstSender(supabase, {
            sender_address: senderAddress,
            first_email_id: gmailMsg.id,
            sender_display: gmailMsg.sender,
            first_received_at: gmailMsg.receivedAt.toISOString(),
            source: "live",
          });
          if (firstEvent) {
            isFirstSender = true;
            const { error: firstFlagError } = await supabase.from("emails" as never)
              .update({ is_first_sender: true } as never)
              .eq("id", gmailMsg.id);
            if (firstFlagError) throw firstFlagError;
            await deliverFirstSenderNotification(supabase, firstEvent, {
              ...gmailMsg,
              senderAddress,
              category,
            });
          }
        }

        const pusher = getPusher();
        await pusher.trigger("gmail-channel", "new-email", {
          id: gmailMsg.id,
          sender: gmailMsg.sender,
          subject: gmailMsg.subject,
          snippet: gmailMsg.snippet,
          received_at: gmailMsg.receivedAt.toISOString(),
          category,
          is_important: important,
          is_first_sender: isFirstSender,
        });
      } catch (err) {
        console.error(`Failed to process message ${messageId}:`, err);
      }
    }
  } catch (err) {
    console.error("listHistory failed:", err);
  }

  await supabase
    .from("gmail_sync_state" as never)
    .update({
      last_history_id: Number(historyId),
      updated_at: new Date().toISOString(),
    } as never)
    .eq("watch_address", emailAddress);

  await refreshSenderTags(supabase).catch((error) => console.error("Sender tag refresh failed:", error));

  return new Response("OK", { status: 200 });
};
