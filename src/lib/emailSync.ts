import { getSupabase } from "./supabase";
import { getPusher } from "./pusher";
import {
  getInboxUnreadCount,
  getMessage,
  getMessageState,
  listMessages,
  listUnreadInboxMessages,
} from "./gmail";
import { classifyEmail } from "./classify";
import { normalizeSenderAddress } from "./senderAddress";
import { registerFirstSender } from "./firstSender";
import { refreshSenderTags } from "./senderTagService";
import { evaluateAndStoreTrust } from "./senderTrustService";

export interface SyncResult {
  imported: number;
  failed: number;
}

export interface ReconcileResult {
  gmailThreadsUnread: number;
  reconciled: number;
  remaining: number;
  failed: number;
  completed: boolean;
}

type SupabaseClient = ReturnType<typeof getSupabase>;

async function importMessage(supabase: SupabaseClient, messageId: string): Promise<void> {
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

      await evaluateAndStoreTrust(supabase, {
        senderAddress,
        emailId: gmailMsg.id,
        authenticationResults: gmailMsg.authenticationResults || null,
        receivedSpf: gmailMsg.receivedSpf || null,
      }).catch((error) => console.error(`評估 ${senderAddress} 的安全狀態失敗:`, error));
    }
  }
}

export async function syncEmailsFromGmail(limit: number): Promise<SyncResult> {
  const supabase = getSupabase();
  const pusher = getPusher();
  let imported = 0;
  let failed = 0;

  const messageIds = await listMessages(limit);
  for (const messageId of messageIds) {
    try {
      await importMessage(supabase, messageId);
      imported++;
    } catch (err) {
      console.error(`Failed to sync message ${messageId}:`, err);
      failed++;
    }
  }

  await pusher.trigger("gmail-channel", "backfill-complete", { imported, failed });
  if (imported > 0) {
    await refreshSenderTags(supabase).catch((error) => console.error("Sender tag refresh failed:", error));
  }
  return { imported, failed };
}

async function listStoredUnreadInboxIds(supabase: SupabaseClient): Promise<string[]> {
  const pageSize = 1000;
  const ids: string[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("emails" as never)
      .select("id")
      .eq("is_read", false)
      .contains("labels", ["INBOX"])
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as { id: string }[];
    ids.push(...rows.map((row) => row.id));
    if (rows.length < pageSize) break;
  }
  return ids;
}

/**
 * 以 Gmail 的 INBOX+UNREAD 集合校正資料庫。只有需要額外 Gmail get 的差異會計入 batchSize，
 * 因此正常狀態只需 list/label 呼叫，不會逼近 serverless 執行時間上限。
 */
export async function reconcileUnreadInbox(
  batchSize = 20,
  recoveryHistoryId?: string,
): Promise<ReconcileResult> {
  const supabase = getSupabase();
  const watchAddress = import.meta.env.GMAIL_WATCH_ADDRESS;
  let effectiveRecoveryHistoryId = recoveryHistoryId;
  if (!effectiveRecoveryHistoryId && watchAddress) {
    const { data } = await supabase
      .from("gmail_sync_state" as never)
      .select("recovery_history_id")
      .eq("watch_address", watchAddress)
      .maybeSingle();
    const storedState = data as { recovery_history_id?: number | null } | null;
    if (storedState?.recovery_history_id) {
      effectiveRecoveryHistoryId = String(storedState.recovery_history_id);
    }
  }
  const [gmailUnread, gmailThreadsUnread, storedIds] = await Promise.all([
    listUnreadInboxMessages(),
    getInboxUnreadCount(),
    listStoredUnreadInboxIds(supabase),
  ]);

  const gmailIds = new Set(gmailUnread.map((message) => message.id));
  const storedSet = new Set(storedIds);
  const missing = gmailUnread.filter((message) => !storedSet.has(message.id));
  const stale = storedIds.filter((id) => !gmailIds.has(id));
  const work = [
    ...missing.map((message) => ({ id: message.id, kind: "missing" as const })),
    ...stale.map((id) => ({ id, kind: "stale" as const })),
  ];

  let reconciled = 0;
  let failed = 0;
  for (const item of work.slice(0, batchSize)) {
    try {
      if (item.kind === "missing") {
        await importMessage(supabase, item.id);
      } else {
        try {
          const state = await getMessageState(item.id);
          const { error } = await supabase.from("emails" as never)
            .update({ labels: state.labels, is_read: state.isRead } as never)
            .eq("id", item.id);
          if (error) throw error;
        } catch (error) {
          const status = (error as { code?: number; response?: { status?: number } })?.response?.status
            ?? (error as { code?: number })?.code;
          if (status !== 404) throw error;
          const { error: deleteError } = await supabase.from("emails" as never).delete().eq("id", item.id);
          if (deleteError) throw deleteError;
        }
      }
      reconciled++;
    } catch (error) {
      console.error(`Failed to reconcile message ${item.id}:`, error);
      failed++;
    }
  }

  const remaining = Math.max(0, work.length - reconciled);
  const completed = remaining === 0 && failed === 0;
  if (watchAddress) {
    const stateUpdate: Record<string, unknown> = {
      watch_address: watchAddress,
      inbox_threads_unread: gmailThreadsUnread,
      reconciliation_status: completed ? "idle" : failed > 0 ? "failed" : "running",
      last_sync_error: failed > 0 ? `${failed} message(s) failed to reconcile` : null,
      updated_at: new Date().toISOString(),
    };
    if (completed) {
      stateUpdate.last_reconciled_at = new Date().toISOString();
      if (effectiveRecoveryHistoryId) {
        stateUpdate.last_history_id = Number(effectiveRecoveryHistoryId);
        stateUpdate.recovery_history_id = null;
      }
    } else if (effectiveRecoveryHistoryId) {
      stateUpdate.recovery_history_id = Number(effectiveRecoveryHistoryId);
    }
    const { error } = await supabase.from("gmail_sync_state" as never).upsert(stateUpdate as never);
    if (error) throw error;
  }

  if (reconciled > 0) {
    await refreshSenderTags(supabase).catch((error) => console.error("Sender tag refresh failed:", error));
  }
  return { gmailThreadsUnread, reconciled, remaining, failed, completed };
}
