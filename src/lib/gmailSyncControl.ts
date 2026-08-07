import { randomUUID } from "node:crypto";
import { getSupabase } from "./supabase";
import { sendGmailBreakerAlert } from "./discord";

export type SyncAdmissionStatus = "acquired" | "busy" | "cooldown" | "duplicate" | "baseline";

export interface SyncAdmission {
  status: SyncAdmissionStatus;
  token: string | null;
  lastHistoryId: number | null;
  retryAfter: string | null;
}

type SupabaseClient = ReturnType<typeof getSupabase>;

export async function acquireGmailSyncLease(
  supabase: SupabaseClient,
  watchAddress: string,
  notificationHistoryId?: string,
  leaseSeconds = 120,
): Promise<SyncAdmission> {
  const token = randomUUID();
  // Some unit-test doubles predate RPC support; production clients always expose rpc().
  if (typeof (supabase as { rpc?: unknown }).rpc !== "function") {
    return { status: "acquired", token, lastHistoryId: null, retryAfter: null };
  }
  const { data, error } = await supabase.rpc("acquire_gmail_sync_lease" as never, {
    p_watch_address: watchAddress,
    p_processing_token: token,
    p_notification_history_id: notificationHistoryId ? Number(notificationHistoryId) : null,
    p_lease_seconds: leaseSeconds,
  } as never);
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as {
    status?: SyncAdmissionStatus;
    last_history_id?: number | null;
    retry_after?: string | null;
  } | null;
  return {
    status: row?.status ?? "busy",
    token: row?.status === "acquired" ? token : null,
    lastHistoryId: row?.last_history_id ?? null,
    retryAfter: row?.retry_after ?? null,
  };
}

export async function releaseGmailSyncLease(
  supabase: SupabaseClient,
  watchAddress: string,
  token: string | null,
): Promise<void> {
  if (!token) return;
  const { error } = await supabase
    .from("gmail_sync_state" as never)
    .update({ processing_token: null, processing_until: null } as never)
    .eq("watch_address", watchAddress)
    .eq("processing_token", token);
  if (error) throw error;
}

export interface GmailFailureRecord {
  consecutiveFailures: number;
  firstFailureAt: string | null;
  /** 已達熔斷門檻，已強制進入長冷卻 */
  tripped: boolean;
  /** 本次故障尚未通知過，應發出 Discord 警告 */
  shouldNotify: boolean;
  cooldownUntil: string | null;
}

/** 判定熔斷的時間窗：失敗必須「持續」這麼久才算故障，而非偶發錯誤。 */
export const FAILURE_WINDOW_SECONDS = 300;
/** 時間窗內至少要累積這麼多次失敗才熔斷。 */
export const FAILURE_MIN_COUNT = 3;
/** 熔斷後的冷卻長度，期間所有同步入口都會被 acquire_gmail_sync_lease 擋下。 */
export const BREAKER_COOLDOWN_SECONDS = 3600;

/**
 * 記錄一次同步失敗。連續失敗持續超過 FAILURE_WINDOW_SECONDS 且達 FAILURE_MIN_COUNT 次時，
 * 強制進入長冷卻並回報 shouldNotify，讓呼叫端發出一次（且僅一次）Discord 警告。
 *
 * 這是為了擋住 Pub/Sub 對 5xx 的無限重送：那條路徑不會觸發 429 冷卻，
 * 錯誤請求可以連續空轉數小時，白白消耗 Gmail 配額與 Supabase egress。
 */
export async function recordGmailFailure(
  supabase: SupabaseClient,
  watchAddress: string,
  errorMessage: string,
): Promise<GmailFailureRecord | null> {
  // 舊的測試替身沒有 rpc()；正式 client 一律具備。
  if (typeof (supabase as { rpc?: unknown }).rpc !== "function") return null;
  const { data, error } = await supabase.rpc("record_gmail_failure" as never, {
    p_watch_address: watchAddress,
    p_error: errorMessage.slice(0, 500),
    p_window_seconds: FAILURE_WINDOW_SECONDS,
    p_min_failures: FAILURE_MIN_COUNT,
    p_cooldown_seconds: BREAKER_COOLDOWN_SECONDS,
  } as never);
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as {
    consecutive_failures?: number;
    first_failure_at?: string | null;
    tripped?: boolean;
    should_notify?: boolean;
    cooldown_until?: string | null;
  } | null;
  if (!row) return null;
  return {
    consecutiveFailures: row.consecutive_failures ?? 0,
    firstFailureAt: row.first_failure_at ?? null,
    tripped: row.tripped ?? false,
    shouldNotify: row.should_notify ?? false,
    cooldownUntil: row.cooldown_until ?? null,
  };
}

/** 同步成功後重設熔斷計數，讓下一段故障能重新累積並重新通知。 */
export async function clearGmailFailures(
  supabase: SupabaseClient,
  watchAddress: string,
): Promise<void> {
  const { error } = await supabase
    .from("gmail_sync_state" as never)
    .update({
      consecutive_failures: 0,
      first_failure_at: null,
      breaker_notified_at: null,
    } as never)
    .eq("watch_address", watchAddress);
  if (error) throw error;
}

/**
 * 各同步入口的統一失敗處理：記錄失敗、必要時熔斷，並在該段故障首次熔斷時發一則 Discord 警告。
 *
 * 本身絕不拋錯——失敗處理再失敗不該蓋掉原始錯誤，也不該讓端點多回一個 500 給 Pub/Sub 重送。
 */
export async function handleGmailSyncFailure(
  supabase: SupabaseClient,
  watchAddress: string | undefined,
  errorMessage: string,
  operation: string,
): Promise<void> {
  if (!watchAddress) return;
  try {
    const record = await recordGmailFailure(supabase, watchAddress, errorMessage);
    if (!record?.tripped) return;
    console.warn("gmail_sync_breaker_tripped", {
      operation,
      consecutiveFailures: record.consecutiveFailures,
      cooldownUntil: record.cooldownUntil,
    });
    if (record.shouldNotify) {
      await sendGmailBreakerAlert({
        watchAddress,
        consecutiveFailures: record.consecutiveFailures,
        firstFailureAt: record.firstFailureAt,
        cooldownUntil: record.cooldownUntil,
        lastError: errorMessage,
      });
    }
  } catch (err) {
    console.error("gmail_sync_failure_record_failed", {
      operation,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function recordGmailCooldown(
  supabase: SupabaseClient,
  watchAddress: string,
  retryAfter: Date,
  errorMessage: string,
): Promise<void> {
  const { error } = await supabase.from("gmail_sync_state" as never).upsert({
    watch_address: watchAddress,
    cooldown_until: retryAfter.toISOString(),
    last_sync_error: errorMessage.slice(0, 500),
    updated_at: new Date().toISOString(),
  } as never);
  if (error) throw error;
}
