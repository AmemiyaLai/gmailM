import type { APIRoute } from "astro";
import { dispatchCleanupReview } from "../../../lib/cleanupReview";

/**
 * 由 /cleanup 頁面手動觸發，立即送一則審核訊息到 Discord。
 * 這支沒有 auth（比照 api/gmail/sync.ts），防濫用靠 dispatchCleanupReview 內的冷卻期，
 * 命中冷卻期時回 429 並帶 Retry-After，讓前端能明確提示。
 */
export const POST: APIRoute = async () => {
  try {
    const result = await dispatchCleanupReview();

    if (result.cooldown) {
      const seconds = Math.ceil(result.cooldown.retryAfterMs / 1000);
      return new Response(
        JSON.stringify({
          error: `送審過於頻繁，請 ${seconds} 秒後再試。`,
          retryAfterMs: result.cooldown.retryAfterMs,
        }),
        {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": String(seconds) },
        },
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "送出失敗" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
