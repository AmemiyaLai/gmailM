import { getSupabase } from "./supabase";
import { getPusher } from "./pusher";
import { listMessages, getMessage } from "./gmail";
import { classifyEmail } from "./classify";

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
      console.error(`Failed to sync message ${messageId}:`, err);
      failed++;
    }
  }

  await pusher.trigger("gmail-channel", "backfill-complete", { imported, failed });

  return { imported, failed };
}
