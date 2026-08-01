import type { APIRoute } from "astro";
import { isCleanupAction } from "../../../lib/cleanupKeywords";
import { processCandidatesNow } from "../../../lib/cleanupReview";

/**
 * 直接處理尚未送審的候選郵件（/reviews 頁面用），不經 Discord。
 * 仍會留下 cleanup_reviews 記錄，與排程路徑的稽核軌跡一致。
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let action: unknown;
  try {
    const body = await request.json();
    action = body.action;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!isCleanupAction(action)) {
    return json({ error: "action 必須是 trash 或 read" }, 400);
  }

  try {
    return json(await processCandidatesNow(action));
  } catch (err) {
    console.error(`Cleanup process-now 失敗 (${action}):`, err);
    return json({ error: err instanceof Error ? err.message : "處理失敗" }, 500);
  }
};
