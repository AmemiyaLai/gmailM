import type { APIRoute } from "astro";
import { OAuth2Client } from "google-auth-library";
import { getSupabase } from "../../../lib/supabase";
import { getPusher } from "../../../lib/pusher";
import {
  classifyGmailApiError,
  getMessage,
  getMessageState,
  isHistoryIdExpired,
  listHistory,
  startWatch,
} from "../../../lib/gmail";
import {
  acquireGmailSyncLease,
  handleGmailSyncFailure,
  recordGmailCooldown,
  releaseGmailSyncLease,
} from "../../../lib/gmailSyncControl";
import { reconcileUnreadInbox } from "../../../lib/emailSync";
import { classifyEmail } from "../../../lib/classify";
import { sendDiscordNotification } from "../../../lib/discord";
import { judgeEmailImportance } from "../../../lib/gemini";
import { normalizeSenderAddress } from "../../../lib/senderAddress";
import { registerFirstSender } from "../../../lib/firstSender";
import { refreshSenderTags } from "../../../lib/senderTagService";
import { evaluateAndStoreTrust } from "../../../lib/senderTrustService";
import { parseGmailNotification, type PubSubPushBody } from "../../../lib/pubsub";
import { isGmailAutomationEnabled } from "../../../lib/gmailAutomation";

interface SyncStateRow {
  watch_address: string;
  last_history_id: number;
  recovery_history_id?: number | null;
  cooldown_until?: string | null;
}

const AUDIENCE = import.meta.env.PUBSUB_AUDIENCE;

async function verifyPubSubToken(
  token: string,
): Promise<boolean> {
  // 訂閱上明確指定的 push service account。Google 不保證能從 token 的其他欄位
  // 推導出這個值，唯一可靠的做法是從設定讀取預期值後比對。
  const expectedEmail = import.meta.env.PUBSUB_PUSH_SERVICE_ACCOUNT;

  try {
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: AUDIENCE,
    });
    const payload = ticket.getPayload();
    if (!payload) return false;

    if (payload.email_verified !== true) {
      console.error("Pub/Sub token 的 email_verified 不為 true：", payload.email);
      return false;
    }

    if (!expectedEmail) {
      console.error(
        `PUBSUB_PUSH_SERVICE_ACCOUNT 未設定，拒絕請求。實際收到的 token email = ${payload.email}`,
      );
      return false;
    }

    if (payload.email !== expectedEmail) {
      console.error(
        `Pub/Sub token email 不符：收到 ${payload.email}，預期 ${expectedEmail}`,
      );
      return false;
    }

    return true;
  } catch (err) {
    console.error("Pub/Sub token 驗證失敗:", err);
    return false;
  }
}

export const POST: APIRoute = async ({ request }) => {
  // 暫停期間先 ACK，避免 Pub/Sub 重送與任何後續驗證／Gmail API 成本。
  if (!isGmailAutomationEnabled()) return new Response(null, { status: 204 });
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = authHeader.slice(7);
  const isValid = await verifyPubSubToken(token);
  if (!isValid) {
    return new Response("Invalid token", { status: 401 });
  }

  const pusher = getPusher();

  let raw: PubSubPushBody;
  try {
    raw = await request.json();
  } catch {
    console.error("Webhook: request body 非合法 JSON");
    return new Response("Invalid JSON", { status: 400 });
  }

  const notification = parseGmailNotification(raw);
  if (!notification) {
    console.error("Webhook: 無法解析 Pub/Sub payload:", JSON.stringify(raw).slice(0, 500));
    return new Response("Missing fields", { status: 400 });
  }
  const { emailAddress, historyId } = notification;

  const supabase = getSupabase();

  let admission;
  try {
    admission = await acquireGmailSyncLease(supabase, emailAddress, historyId);
  } catch (error) {
    console.error("gmail_sync_lease_acquire_failed", { message: error instanceof Error ? error.message : String(error) });
    return new Response("Sync lease failed", { status: 500 });
  }
  if (admission.status !== "acquired") {
    return new Response(null, {
      status: 204,
      headers: admission.retryAfter ? { "Retry-After": admission.retryAfter } : undefined,
    });
  }
  const releaseLease = async () => {
    await releaseGmailSyncLease(supabase, emailAddress, admission.token).catch((error) =>
      console.error("gmail_sync_lease_release_failed", { message: error instanceof Error ? error.message : String(error) }),
    );
  };

  const { data: syncState } = await supabase
    .from("gmail_sync_state" as never)
    .select("last_history_id, recovery_history_id, cooldown_until")
    .eq("watch_address", emailAddress)
    .single() as { data: SyncStateRow | null };

  const lastHistoryId = syncState?.last_history_id;

  if (syncState?.cooldown_until && new Date(syncState.cooldown_until).getTime() > Date.now()) {
    await releaseLease();
    return new Response(null, { status: 204 });
  }

  if (!lastHistoryId) {
    await supabase.from("gmail_sync_state" as never).upsert({
      watch_address: emailAddress,
      last_history_id: Number(historyId),
      updated_at: new Date().toISOString(),
    } as never);
    await releaseLease();
    return new Response(null, { status: 204 });
  }

  if (Number(historyId) <= Number(lastHistoryId)) {
    await releaseLease();
    return new Response(null, { status: 204 });
  }

  // 只有整段處理都成功才前推 last_history_id，否則回非 2xx 讓 Pub/Sub 重送，
  // 避免尚未寫入的郵件因為游標前推而永久遺失。
  let latestHistoryId = String(lastHistoryId);
  let hadFailure = false;
  let rateLimitError: ReturnType<typeof classifyGmailApiError> | null = null;

  try {
    const { historyId: fetchedHistoryId, messages } = await listHistory(String(lastHistoryId));
    // 以最後一次成功 history.list 回應的 historyId 為準（Gmail 官方建議）
    latestHistoryId = fetchedHistoryId || historyId;


    for (const change of messages) {
      const { messageId } = change;
      const kind = change.kind ?? "added";
      try {
        if (kind === "deleted") {
          const { error } = await supabase.from("emails" as never).delete().eq("id", messageId);
          if (error) throw error;
          continue;
        }

        // 冪等守門：重送時已處理過的郵件直接跳過，避免重複處理
        const { data: existing } = await supabase
          .from("emails" as never)
          .select("id, is_important, category")
          .eq("id", messageId)
          .maybeSingle() as { data: { id: string; is_important?: boolean; category?: string | null } | null };

        // 既有郵件或標籤事件只需刷新 Gmail 狀態，不能再因 category 已存在而跳過。
        if (existing || kind === "stateChanged") {
          const state = await getMessageState(messageId);
          if (existing) {
            const { error } = await supabase.from("emails" as never)
              .update({ labels: state.labels, is_read: state.isRead } as never)
              .eq("id", messageId);
            if (error) throw error;
            if (existing.category !== null) continue;
          }
          // 非收件匣狀態變更且本地沒有此信，不需建立歷史資料。
          if (!state.labels.includes("INBOX")) continue;
        }

        const gmailMsg = await getMessage(messageId);
        const senderAddress = normalizeSenderAddress(gmailMsg.sender);

        // --- 階段一：極速寫入與 `new-email` 推送 ---
        if (!existing) {
          const { error: initialUpsert } = await supabase.from("emails" as never).upsert(
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
              authentication_results: gmailMsg.authenticationResults || null,
              received_spf: gmailMsg.receivedSpf || null,
            } as never,
            { onConflict: "id" },
          );
          if (initialUpsert) throw initialUpsert;

          // 毫秒級向前端推送 new-email 事件，此時為極簡 payload
          await pusher.trigger("gmail-channel", "new-email", {
            id: gmailMsg.id,
            sender: gmailMsg.sender,
            subject: gmailMsg.subject,
            snippet: gmailMsg.snippet,
            received_at: gmailMsg.receivedAt.toISOString(),
            is_read: gmailMsg.isRead,
          }).catch((e) => console.error("Pusher new-email trigger failed:", e));
        }

        // --- 階段二：異步/順序執行 AI 判斷與特徵豐富化 ---
        const category = classifyEmail({ sender: gmailMsg.sender, subject: gmailMsg.subject });
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

        const { error: enrichError } = await supabase.from("emails" as never).update(
          {
            category,
            is_important: important,
            importance_reason: importanceReason ?? null,
          } as never,
        ).eq("id", gmailMsg.id);
        if (enrichError) throw enrichError;

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

            // 安全狀態評估失敗不得影響 history cursor 前推。
            await evaluateAndStoreTrust(supabase, {
              senderAddress,
              emailId: gmailMsg.id,
              authenticationResults: gmailMsg.authenticationResults || null,
              receivedSpf: gmailMsg.receivedSpf || null,
            }).catch((error) => console.error(`評估 ${senderAddress} 的安全狀態失敗:`, error));

            // 不再即時發送 Discord 通知；事件維持 pending，
            // 由每日 07:00 / 19:00 的 first-sender-digest 排程彙整成摘要發送。
          }
        }

        // 推送特徵增強事件給前端，使卡片動態長出分類 Badge 與重要標記
        await pusher.trigger("gmail-channel", "email-enriched", {
          id: gmailMsg.id,
          category,
          is_important: important,
          is_first_sender: isFirstSender,
        }).catch((e) => console.error("Pusher email-enriched trigger failed:", e));

        if (important) {
          await sendDiscordNotification({ ...gmailMsg, category }).catch((err) =>
            console.error(`Failed to send Discord notification for ${messageId}:`, err),
          );
        }

      } catch (err) {
        const info = classifyGmailApiError(err);
        if (info.rateLimited) rateLimitError = info;
        console.error("gmail_message_process_failed", { messageId, status: info.status, message: info.message });
        hadFailure = true;
      }
    }
  } catch (err) {
    if (isHistoryIdExpired(err)) {
      try {
        const recoveryHistoryId = syncState?.recovery_history_id
          ? String(syncState.recovery_history_id)
          : (await startWatch()).historyId;
        const result = await reconcileUnreadInbox(20, recoveryHistoryId);
        await releaseLease();
        return new Response(JSON.stringify({ status: "reconciling", ...result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (recoveryError) {
        const info = classifyGmailApiError(recoveryError);
        if (info.rateLimited) {
          const retryAfter = info.retryAfter ?? new Date(Date.now() + 15 * 60_000);
          await recordGmailCooldown(supabase, emailAddress, retryAfter, info.message).catch(() => undefined);
          await releaseLease();
          return new Response(null, { status: 204 });
        }
        console.error("gmail_history_recovery_failed", { status: info.status, message: info.message });
        await handleGmailSyncFailure(supabase, emailAddress, info.message, "historyRecovery");
        await releaseLease();
        return new Response("History recovery failed", { status: 500 });
      }
    }
    const info = classifyGmailApiError(err);
    if (info.rateLimited) {
      const retryAfter = info.retryAfter ?? new Date(Date.now() + 15 * 60_000);
      await recordGmailCooldown(supabase, emailAddress, retryAfter, info.message).catch((dbError) =>
        console.error("gmail_cooldown_persist_failed", { message: dbError instanceof Error ? dbError.message : String(dbError) }),
      );
      console.warn("gmail_rate_limited", { operation: "listHistory", retryAfter: retryAfter.toISOString() });
      await releaseLease();
      return new Response(null, { status: 204 });
    }
    console.error("gmail_list_history_failed", { status: info.status, message: info.message });
    await handleGmailSyncFailure(supabase, emailAddress, info.message, "listHistory");
    await releaseLease();
    return new Response("listHistory failed", { status: 500 });
  }

  if (hadFailure) {
    if (rateLimitError) {
      const retryAfter = rateLimitError.retryAfter ?? new Date(Date.now() + 15 * 60_000);
      await recordGmailCooldown(supabase, emailAddress, retryAfter, rateLimitError.message).catch(() => undefined);
      await releaseLease();
      return new Response(null, { status: 204 });
    }
    console.error("部分郵件處理失敗，保留 last_history_id 以待 Pub/Sub 重送");
    await handleGmailSyncFailure(supabase, emailAddress, "部分郵件處理失敗", "processMessages");
    await releaseLease();
    return new Response("Partial failure", { status: 500 });
  }

  const { error: cursorError } = await supabase
    .from("gmail_sync_state" as never)
    .update({
      last_history_id: Number(latestHistoryId),
      cooldown_until: null,
      last_sync_error: null,
      // 同步成功即重設熔斷計數，讓下一段故障能重新累積並重新發出警告
      consecutive_failures: 0,
      first_failure_at: null,
      breaker_notified_at: null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("watch_address", emailAddress);
  if (cursorError) {
    console.error("gmail_cursor_update_failed", { message: cursorError.message });
    await handleGmailSyncFailure(supabase, emailAddress, cursorError.message, "cursorUpdate");
    await releaseLease();
    return new Response("Cursor update failed", { status: 500 });
  }

  await refreshSenderTags(supabase).catch((error) => console.error("Sender tag refresh failed:", error));

  // 推送同步完成事件，通知前端同步游標已前進
  await pusher.trigger("gmail-channel", "sync-complete", {
    last_history_id: latestHistoryId,
    updated_at: new Date().toISOString(),
  }).catch((e) => console.error("Pusher sync-complete trigger failed:", e));

  await releaseLease();
  return new Response("OK", { status: 200 });
};
