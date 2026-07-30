import { getSupabase } from "./supabase";
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
  const { data } = await supabase
    .from("cleanup_reviews" as never)
    .select(REVIEW_COLUMNS)
    .eq("id", reviewId)
    .maybeSingle();
  return (data ?? null) as CleanupReviewRow | null;
}

export async function listReviews(limit = 20): Promise<CleanupReviewRow[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("cleanup_reviews" as never)
    .select(REVIEW_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as CleanupReviewRow[];
}

export type DispatchOneResult =
  | { action: CleanupAction; status: "skipped"; reason: string }
  | { action: CleanupAction; status: "ok"; reviewId: string; emailCount: number };

export interface DispatchResult {
  results: DispatchOneResult[];
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
    // Discord 送不出去時把審核單標成 failed，否則這批郵件會被 idsUnderReview 永久卡住
    await getSupabase()
      .from("cleanup_reviews" as never)
      .update({
        status: "failed",
        last_error: err instanceof Error ? err.message : String(err),
        decided_at: new Date().toISOString(),
      } as never)
      .eq("id", review.id);
    throw err;
  }

  if (messageId) {
    await getSupabase()
      .from("cleanup_reviews" as never)
      .update({ discord_message_id: messageId } as never)
      .eq("id", review.id);
  }

  return { action, status: "ok", reviewId: review.id, emailCount: review.email_count };
}

/**
 * 掃描兩條審核線（trash / read）的候選郵件，各自送出一則 Discord 審核訊息。
 * 兩者互不影響：其中一邊送出失敗，另一邊仍會照常送出（回傳結果中各自標示狀態）。
 */
export async function dispatchCleanupReview(): Promise<DispatchResult> {
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
 */
async function claimPending(reviewId: string, nextStatus: CleanupReviewStatus): Promise<CleanupReviewRow | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("cleanup_reviews" as never)
    .update({ status: nextStatus, decided_at: new Date().toISOString() } as never)
    .eq("id", reviewId)
    .eq("status", "pending")
    .select(REVIEW_COLUMNS);

  const rows = (data ?? []) as CleanupReviewRow[];
  return rows[0] ?? null;
}

/**
 * 通過審核：依 action 執行對應動作。
 * - trash：郵件移到 Gmail 垃圾桶，並從 Supabase 移除該列（與 src/pages/api/emails/bulk.ts 的 trash 語意一致）。
 * - read：Gmail 標記已讀，並同步 Supabase is_read=true（與 bulk.ts 的 read 語意一致），郵件本身保留。
 */
export async function approveReview(reviewId: string): Promise<DecisionResult> {
  const review = await claimPending(reviewId, "approved");
  if (!review) return { status: "already-handled" };

  const ids = review.email_ids ?? [];
  const gmailFn = review.action === "trash" ? trashMessage : markAsRead;
  const results = await Promise.allSettled(ids.map((id) => gmailFn(id)));

  const succeeded: string[] = [];
  const errors: string[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      succeeded.push(ids[i]);
    } else {
      console.error(`Cleanup review ${reviewId} (${review.action}): 失敗 ${ids[i]}:`, result.reason);
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

  await supabase
    .from("cleanup_reviews" as never)
    .update({
      processed_count: succeeded.length,
      last_error: errors.length > 0 ? errors.join("\n").slice(0, 2000) : null,
    } as never)
    .eq("id", reviewId);

  return {
    status: "approved",
    action: review.action,
    processedCount: succeeded.length,
    failedCount: ids.length - succeeded.length,
  };
}

/** 取消審核：不動 Gmail，郵件保留 */
export async function rejectReview(reviewId: string): Promise<DecisionResult> {
  const review = await claimPending(reviewId, "rejected");
  if (!review) return { status: "already-handled" };
  return { status: "rejected", action: review.action, emailCount: review.email_count };
}
