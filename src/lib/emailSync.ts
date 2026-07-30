import { getSupabase } from "./supabase";
import { getPusher } from "./pusher";
import { listMessages, getMessage } from "./gmail";
import { classifyEmail } from "./classify";
import { normalizeSenderAddress } from "./senderAddress";
import { registerFirstSender } from "./firstSender";
import { refreshSenderTags } from "./senderTagService";
import { evaluateAndStoreTrust } from "./senderTrustService";

export interface SyncResult {
  imported: number;
  failed: number;
}

export async function syncEmailsFromGmail(limit: number): Promise<SyncResult> {
  const supabase = getSupabase();
  const pusher = getPusher();

  let imported = 0;
  let failed = 0;

  const messageIds = await listMessages(limit);

  for (const messageId of messageIds) {
    try {
      const gmailMsg = await getMessage(messageId);
      const category = classifyEmail({ sender: gmailMsg.sender, subject: gmailMsg.subject });
      const senderAddress = normalizeSenderAddress(gmailMsg.sender);

      const { error } = await supabase.from("emails" as never).upsert(
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
          authentication_results: gmailMsg.authenticationResults || null,
          received_spf: gmailMsg.receivedSpf || null,
        } as never,
        { onConflict: "id" },
      );

      if (error) throw error;

      // 回填只建立基線，避免對歷史寄件者產生大量 Discord 訊息。
      if (senderAddress) {
        const firstEvent = await registerFirstSender(supabase, {
          sender_address: senderAddress,
          first_email_id: gmailMsg.id,
          sender_display: gmailMsg.sender,
          first_received_at: gmailMsg.receivedAt.toISOString(),
          source: "baseline",
        });
        if (firstEvent) {
          const { error: firstFlagError } = await supabase.from("emails" as never)
            .update({ is_first_sender: true } as never)
            .eq("id", gmailMsg.id);
          if (firstFlagError) throw firstFlagError;

          // 標頭已在記憶體，判定不需額外的 Gmail 呼叫；失敗不影響本封信的匯入。
          await evaluateAndStoreTrust(supabase, {
            senderAddress,
            emailId: gmailMsg.id,
            authenticationResults: gmailMsg.authenticationResults || null,
            receivedSpf: gmailMsg.receivedSpf || null,
          }).catch((error) => console.error(`評估 ${senderAddress} 的安全狀態失敗:`, error));
        }
      }
      imported++;
    } catch (err) {
      console.error(`Failed to sync message ${messageId}:`, err);
      failed++;
    }
  }

  await pusher.trigger("gmail-channel", "backfill-complete", { imported, failed });
  if (imported > 0) await refreshSenderTags(supabase).catch((error) => console.error("Sender tag refresh failed:", error));

  return { imported, failed };
}
