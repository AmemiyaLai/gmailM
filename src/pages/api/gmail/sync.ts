import type { APIRoute } from "astro";
import { reconcileUnreadInbox } from "../../../lib/emailSync";

const RECONCILE_BATCH_SIZE = 20;

export const POST: APIRoute = async () => {
  try {
    const result = await reconcileUnreadInbox(RECONCILE_BATCH_SIZE);
    return new Response(JSON.stringify({ status: result.completed ? "ok" : "reconciling", ...result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Manual sync failed:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
