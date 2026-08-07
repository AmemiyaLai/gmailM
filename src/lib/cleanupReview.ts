import { getSupabase, unwrapQuery } from "./supabase";
import { trashMessage, markAsRead } from "./gmail";
import { sendCleanupReview } from "./discord";
import { findCandidates, type CleanupAction, type CleanupMatch } from "./cleanupKeywords";

/**
 * 關鍵字清理審核單的生命週期：
 *   findCandidates(action) → createPendingReview → Discord 訊息（含按鈕）
 *   → 使用者點擊 → approveReview（依 action 移到垃圾桶或標記已讀）／rejectReview
 *
 * trash 與 read 是兩條完全獨立的審核線：各自的關鍵字、各自的 Discord 訊息與按鈕文案、
 * 各自的審核記錄，只有「避免同一封信被兩邊同時排審」這件事共用（見 cleanupKeywords.idsUnderReview）。
 */

export type CleanupReviewStatus = "pending" | "approved" | "rejected" | "failed";

export interface CleanupMatchedEmail {
  id: string;
  sender: string;
  subject: string;
  keyword: string;
}

export interface CleanupReviewRow {
  id: string;
  action: CleanupAction;
  status: CleanupReviewStatus;
  email_ids: string[];
  matched: CleanupMatchedEmail[];
  email_count: number;
  discord_message_id: string | null;
  processed_count: number | null;
  last_error: string | null;
  created_at: string;
  decided_at: string | null;
}

const REVIEW_COLUMNS =
  "id, action, status, email_ids, matched, email_count, discord_message_id, processed_count, last_error, created_at, decided_at";

function toMatchedEmails(matches: CleanupMatch[]): CleanupMatchedEmail[] {
  return matches.map(({ email, keyword }) => ({
    id: email.id,
    sender: email.sender || "(未知)",
    subject: email.subject || "(無主旨)",
    keyword,
  }));
}

export async function createPendingReview(action: CleanupAction, matches: CleanupMatch[]): Promise<CleanupReviewRow> {
  const matched = toMatchedEmails(matches);
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("cleanup_reviews" as never)
    .insert({
      action,
      status: "pending",
      email_ids: matched.map((m) => m.id),
      matched,
      email_count: matched.length,
    } as never)
    .select(REVIEW_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as CleanupReviewRow;
}

export async function getReview(reviewId: string): Promise<CleanupReviewRow | null> {
  const supabase = getSupabase();
  const result = await supabase
    .from("cleanup_reviews" as never)
    .select(REVIEW_COLUMNS)
    .eq("id", reviewId)
    .maybeSingle();
  return (unwrapQuery(result, "getReview") ?? null) as CleanupReviewRow | null;
}

export async function listReviews(limit = 20): Promise<CleanupReviewRow[]> {
  const supabase = getSupabase();
  const result = await supabase
    .from("cleanup_reviews" as never)
    .select(REVIEW_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (unwrapQuery(result, "listReviews") ?? []) as CleanupReviewRow[];
}

/** 只取還在等使用者決定的審核單（/reviews 頁面與首頁統計卡用） */
export async function listPendingReviews(limit = 50): Promise<CleanupReviewRow[]> {
  const supabase = getSupabase();
  const result = await supabase
    .from("cleanup_reviews" as never)
    .select(REVIEW_COLUMNS)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (unwrapQuery(result, "listPendingReviews") ?? []) as CleanupReviewRow[];
}

/**
 * 待審核統計：pending 審核單數與其涵蓋的郵件總數。
 * 首頁統計卡顯示 emails —— 那才是「等你做決定的郵件」數量。
 */
export async function getPendingReviewCount(): Promise<{ reviews: number; emails: number }> {
  const supabase = getSupabase();
  const result = await supabase
    .from("cleanup_reviews" as never)
    .select("email_count")
    .eq("status", "pending");

  const rows = (unwrapQuery(result, "getPendingReviewCount") ?? []) as { email_count: number | null }[];
  return {
    reviews: rows.length,
    emails: rows.reduce((sum, row) => sum + (row.email_count ?? 0), 0),
  };
}

export type DispatchOneResult =
  | { action: CleanupAction; status: "skipped"; reason: string }
  | { action: CleanupAction; status: "ok"; reviewId: string; emailCount: number };

export interface DispatchResult {
  results: DispatchOneResult[];
  /** 因冷卻期而整批跳過時帶上，說明還要等多久 */
  cooldown?: { retryAfterMs: number };
}

/**
 * 兩次送審之間的最短間隔。
 * /api/cleanup/dispatch 沒有 auth（給頁面按鈕用），沒有這道防線的話連點或外部重複請求
 * 會把 Discord 洗版、並產生一堆重複審核單。
 *
 * 判斷依據是 DB 裡最新一筆 cleanup_reviews 的 created_at，而非行程內的變數——
 * Vercel serverless 每次請求可能落在不同執行實例上，記憶體狀態不可靠。
 */
export const DISPATCH_COOLDOWN_MS = 5_000;

/** 最近一次送審時間（含送出失敗的，失敗也算「已嘗試」，不該立刻重試） */
async function lastDispatchAt(): Promise<Date | null> {
  const supabase = getSupabase();
  const result = await supabase
    .from("cleanup_reviews" as never)
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = unwrapQuery(result, "lastDispatchAt") as { created_at?: string } | null;
  return row?.created_at ? new Date(row.created_at) : null;
}

async function dispatchOne(action: CleanupAction): Promise<DispatchOneResult> {
  const matches = await findCandidates(action);
  if (matches.length === 0) {
    return { action, status: "skipped", reason: "no matching emails" };
  }

  const review = await createPendingReview(action, matches);

  let messageId: string | null = null;
  try {
    messageId = await sendCleanupReview({
      reviewId: review.id,
      action,
      emails: review.matched,
    });
  } catch (err) {
    // Discord 送不出去時把審核單標成 failed，否則這批郵件會被 idsUnderReview 永久卡住。
    // 這裡的寫入失敗不改寫主流程結果（原始錯誤更重要），但要留痕。
    const marked = await getSupabase()
      .from("cleanup_reviews" as never)
      .update({
        status: "failed",
        last_error: err instanceof Error ? err.message : String(err),
        decided_at: new Date().toISOString(),
      } as never)
      .eq("id", review.id);
    if (marked.error) {
      console.error(`Cleanup review ${review.id}: 標記 failed 失敗:`, marked.error.message);
    }
    throw err;
  }

  if (messageId) {
    const saved = await getSupabase()
      .from("cleanup_reviews" as never)
      .update({ discord_message_id: messageId } as never)
      .eq("id", review.id);
    if (saved.error) {
      console.error(`Cleanup review ${review.id}: 寫入 discord_message_id 失敗:`, saved.error.message);
    }
  }

  return { action, status: "ok", reviewId: review.id, emailCount: review.email_count };
}

/**
 * 掃描兩條審核線（trash / read）的候選郵件，各自送出一則 Discord 審核訊息。
 * 兩者互不影響：其中一邊送出失敗，另一邊仍會照常送出（回傳結果中各自標示狀態）。
 *
 * 冷卻期只在進入時檢查一次，因此同一次呼叫仍可送出 trash + read 兩則訊息，
 * 但下一次呼叫必須等 DISPATCH_COOLDOWN_MS 之後。
 */
export async function dispatchCleanupReview(): Promise<DispatchResult> {
  const last = await lastDispatchAt();
  if (last) {
    const elapsed = Date.now() - last.getTime();
    if (elapsed >= 0 && elapsed < DISPATCH_COOLDOWN_MS) {
      const retryAfterMs = DISPATCH_COOLDOWN_MS - elapsed;
      return {
        cooldown: { retryAfterMs },
        results: (["trash", "read"] as const).map((action) => ({
          action,
          status: "skipped" as const,
          reason: "cooldown",
        })),
      };
    }
  }

  const results: DispatchOneResult[] = [];

  for (const action of ["trash", "read"] as const) {
    try {
      results.push(await dispatchOne(action));
    } catch (err) {
      results.push({ action, status: "skipped", reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { results };
}

export type DecisionResult =
  | { status: "already-handled" }
  | { status: "approved"; action: CleanupAction; processedCount: number; failedCount: number }
  | { status: "rejected"; action: CleanupAction; emailCount: number };

/**
 * 條件式搶佔 pending 狀態，避免使用者連點造成重複處理。
 * 回傳 null 即代表這則審核已被處理過。
 *
 * 查詢失敗必須拋出，不能當成 null：否則會回報「已經處理過了」，
 * 但實際上什麼都沒做，郵件仍留在原處而使用者以為完成了。
 */
async function claimPending(reviewId: string, nextStatus: CleanupReviewStatus): Promise<CleanupReviewRow | null> {
  const supabase = getSupabase();
  const result = await supabase
    .from("cleanup_reviews" as never)
    .update({ status: nextStatus, decided_at: new Date().toISOString() } as never)
    .eq("id", reviewId)
    .eq("status", "pending")
    .select(REVIEW_COLUMNS);

  const rows = (unwrapQuery(result, "claimPending") ?? []) as CleanupReviewRow[];
  return rows[0] ?? null;
}

/**
 * 對已搶佔的審核單實際執行動作。
 * - trash：郵件移到 Gmail 垃圾桶，並從 Supabase 移除該列（與 src/pages/api/emails/bulk.ts 的 trash 語意一致）。
 * - read：Gmail 標記已讀，並同步 Supabase is_read=true（與 bulk.ts 的 read 語意一致），郵件本身保留。
 *
 * 這一段刻意與 claimPending 分開，讓 resumeStuckReviews 能在中途中斷後重跑。
 * 重跑是安全的：Gmail 的 trash / markAsRead 對已處理的郵件都是幂等的，
 * Supabase 的 delete / update 也不會因為重複執行而出錯。
 */
async function executeReviewAction(
  review: CleanupReviewRow,
): Promise<{ processedCount: number; failedCount: number }> {
  const ids = review.email_ids ?? [];
  const gmailFn = review.action === "trash" ? trashMessage : markAsRead;
  const results = await Promise.allSettled(ids.map((id) => gmailFn(id)));

  const succeeded: string[] = [];
  const errors: string[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      succeeded.push(ids[i]);
    } else {
      console.error(`Cleanup review ${review.id} (${review.action}): 失敗 ${ids[i]}:`, result.reason);
      errors.push(`${ids[i]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    }
  });

  const supabase = getSupabase();
  if (succeeded.length > 0) {
    const { error } =
      review.action === "trash"
        ? await supabase.from("emails" as never).delete().in("id", succeeded)
        : await supabase.from("emails" as never).update({ is_read: true } as never).in("id", succeeded);
    if (error) errors.push(`Supabase 更新失敗：${error.message}`);
  }

  // processed_count 由 null 變成數字，同時也是「這則審核已完成處理」的標記，
  // resumeStuckReviews 靠它判斷有沒有做完。寫入失敗不改寫回傳結果（動作已經做了），
  // 但要留痕 —— 沒寫進去的話 resumeStuckReviews 之後會重跑一次（冪等，安全）。
  const saved = await supabase
    .from("cleanup_reviews" as never)
    .update({
      processed_count: succeeded.length,
      last_error: errors.length > 0 ? errors.join("\n").slice(0, 2000) : null,
    } as never)
    .eq("id", review.id);
  if (saved.error) {
    console.error(`Cleanup review ${review.id}: 寫入 processed_count 失敗:`, saved.error.message);
  }

  return { processedCount: succeeded.length, failedCount: ids.length - succeeded.length };
}

/** 通過審核：搶佔 pending 後執行對應動作 */
export async function approveReview(reviewId: string): Promise<DecisionResult> {
  const review = await claimPending(reviewId, "approved");
  if (!review) return { status: "already-handled" };

  const { processedCount, failedCount } = await executeReviewAction(review);
  return { status: "approved", action: review.action, processedCount, failedCount };
}

/** 視為「處理中斷」的判定門檻：已按下確認但超過這個時間仍未寫入 processed_count */
export const STUCK_REVIEW_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * 安全網：補做那些「已按下確認、但處理過程被中斷」的審核單。
 *
 * 按鈕的實際處理跑在回應送出後的背景工作裡（Vercel 走 waitUntil，自托管直接背景執行），
 * 理論上會完成，但若行程在中途中斷（部署、逾時、當機），
 * 審核單會停在 status=approved 而 processed_count 為 null。
 * 這支由 cron 呼叫，把這些補做完，避免郵件卡在「已核准但沒動作」的狀態。
 */
export async function resumeStuckReviews(): Promise<{ resumed: number; processed: number }> {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - STUCK_REVIEW_THRESHOLD_MS).toISOString();

  const result = await supabase
    .from("cleanup_reviews" as never)
    .select(REVIEW_COLUMNS)
    .eq("status", "approved")
    .is("processed_count", null)
    .lt("decided_at", cutoff);

  const stuck = (unwrapQuery(result, "resumeStuckReviews") ?? []) as CleanupReviewRow[];
  let processed = 0;

  for (const review of stuck) {
    try {
      const result = await executeReviewAction(review);
      processed += result.processedCount;
      console.warn(`Cleanup review ${review.id}: 補做完成（${result.processedCount} 封）`);
    } catch (err) {
      console.error(`Cleanup review ${review.id}: 補做失敗:`, err);
    }
  }

  return { resumed: stuck.length, processed };
}

/** 取消審核：不動 Gmail，郵件保留 */
export async function rejectReview(reviewId: string): Promise<DecisionResult> {
  const review = await claimPending(reviewId, "rejected");
  if (!review) return { status: "already-handled" };
  return { status: "rejected", action: review.action, emailCount: review.email_count };
}

export type ProcessNowResult =
  | { status: "skipped"; reason: string }
  | { status: "ok"; action: CleanupAction; reviewId: string; processedCount: number; failedCount: number };

/**
 * 直接處理「命中關鍵字但還沒送審」的郵件，不經 Discord。
 * 供 /reviews 頁面使用，讓使用者不必等 07:00／19:00 的排程。
 *
 * 仍然會建立 cleanup_reviews 記錄（discord_message_id 留 null），稽核軌跡與排程路徑一致。
 */
export async function processCandidatesNow(action: CleanupAction): Promise<ProcessNowResult> {
  const matches = await findCandidates(action);
  if (matches.length === 0) return { status: "skipped", reason: "no matching emails" };

  const review = await createPendingReview(action, matches);
  // 使用者在網頁上就是本人確認，直接搶佔後執行；搶佔失敗代表剛剛被別的入口處理掉了
  const claimed = await claimPending(review.id, "approved");
  if (!claimed) return { status: "skipped", reason: "already handled" };

  const { processedCount, failedCount } = await executeReviewAction(claimed);
  return { status: "ok", action, reviewId: review.id, processedCount, failedCount };
}
