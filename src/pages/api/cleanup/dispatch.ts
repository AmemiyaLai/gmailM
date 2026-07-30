import type { APIRoute } from "astro";
import { dispatchCleanupReview } from "../../../lib/cleanupReview";

/** 由 /cleanup 頁面手動觸發，立即送一則審核訊息到 Discord */
export const POST: APIRoute = async () => {
  try {
    const result = await dispatchCleanupReview();
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
