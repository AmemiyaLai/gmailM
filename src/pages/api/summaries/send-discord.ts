import type { APIRoute } from "astro";
import { sendSummaryToDiscord, SummaryError } from "../../../lib/summaryService";

interface SendBody {
  /** 指定要發送的摘要 id；省略時發送最新一筆 */
  summaryId?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let body: SendBody = {};
  try {
    const raw = await request.text();
    if (raw) body = JSON.parse(raw) as SendBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    const summary = await sendSummaryToDiscord(body.summaryId);
    return json({ status: "ok", emailCount: summary.emailCount });
  } catch (err) {
    if (err instanceof SummaryError) {
      const notFound = err.message === "Summary not found";
      return json({ error: notFound ? "找不到指定的摘要記錄。" : err.message }, notFound ? 404 : 500);
    }
    console.error("Manual Discord summary send failed:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 502);
  }
};
