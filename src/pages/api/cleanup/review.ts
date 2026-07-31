import type { APIRoute } from "astro";
import { approveReview, rejectReview } from "../../../lib/cleanupReview";

/**
 * 網頁端的審核決策（/reviews 頁面用）。
 * Discord 按鈕走 api/discord/interactions，兩者最終都呼叫同一組 approveReview / rejectReview，
 * 靠 claimPending 的條件式搶佔確保同一則審核只會被執行一次。
 *
 * 與 dispatch.ts 一樣不加 auth（整站在 Cloudflare Access 之後）。
 * 網頁沒有 Discord 的 3 秒限制，因此直接同步等處理完成，不需要 deferred 機制。
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let reviewId: unknown;
  let decision: unknown;
  try {
    const body = await request.json();
    reviewId = body.reviewId;
    decision = body.decision;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof reviewId !== "string" || reviewId === "") {
    return json({ error: "缺少 reviewId" }, 400);
  }
  if (decision !== "approve" && decision !== "reject") {
    return json({ error: "decision 必須是 approve 或 reject" }, 400);
  }

  try {
    const result = decision === "approve" ? await approveReview(reviewId) : await rejectReview(reviewId);
    return json(result);
  } catch (err) {
    console.error(`Cleanup review ${decision} 失敗 (${reviewId}):`, err);
    return json({ error: err instanceof Error ? err.message : "處理失敗" }, 500);
  }
};
