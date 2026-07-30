import type { APIRoute } from "astro";
import { dispatchCleanupReview, resumeStuckReviews } from "../../../lib/cleanupReview";

/**
 * 關鍵字清理定時掃描。
 * 排程：每天台北時間 07:00 與 19:00（UTC cron `0 11,23 * * *`），
 * 由外部排程服務帶 `Authorization: Bearer <CRON_SECRET>` 觸發，
 * 與其他 cron 路由（hourly-summary、reclassify…）一致。
 *
 * 一次掃描會分別處理「刪除」與「已讀」兩條審核線，各自最多送一則 Discord 訊息
 * （見 lib/cleanupReview.dispatchCleanupReview），回應中的 results 陣列會列出兩者結果。
 *
 * dispatchCleanupReview 內建 5 秒冷卻期，主要是擋 /api/cleanup/dispatch 被連點；
 * 一天只跑兩次的排程不會受影響，但若排程被重複觸發，回應會帶 cooldown 欄位而不會重複送出。
 *
 * 掃描前會先補做「已按下確認但處理中斷」的審核單（resumeStuckReviews），
 * 作為 Discord 按鈕背景工作的安全網。
 */
export const GET: APIRoute = async ({ request }) => {
  const authHeader = request.headers.get("authorization");
  const cronSecret = import.meta.env.CRON_SECRET;

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 補做失敗不應阻擋本輪掃描，僅記錄
  let resumed: { resumed: number; processed: number } = { resumed: 0, processed: 0 };
  try {
    resumed = await resumeStuckReviews();
  } catch (err) {
    console.error("Cleanup scan: 補做中斷的審核單失敗:", err);
  }

  try {
    const result = await dispatchCleanupReview();
    return new Response(JSON.stringify({ ...result, resumed }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Cleanup scan 失敗:", err);
    return new Response(
      JSON.stringify({ status: "error", message: err instanceof Error ? err.message : "Internal error", resumed }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
