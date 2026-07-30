import type { APIRoute } from "astro";
import { sendDiscordSummary } from "../../../lib/discord";
import { generateUnreadSummary, SummaryError } from "../../../lib/summaryService";

interface GenerateBody {
  /** 是否略過「自上次摘要後沒有新未讀郵件」檢查，手動觸發預設為 true */
  force?: boolean;
  /** 產生後是否同時推送 Discord，預設 false */
  sendDiscord?: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let body: GenerateBody = {};
  try {
    const raw = await request.text();
    if (raw) body = JSON.parse(raw) as GenerateBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    const result = await generateUnreadSummary({ force: body.force !== false });

    if (result.status === "skipped") {
      return json({ status: "skipped", reason: result.reason });
    }

    let discordSent = false;
    if (body.sendDiscord) {
      try {
        await sendDiscordSummary({
          summaryText: result.summaryText,
          emailCount: result.emailCount,
          periodStart: result.periodStart,
          periodEnd: result.periodEnd,
          manual: true,
        });
        discordSent = true;
      } catch (err) {
        console.error("Manual summary: Discord send failed:", err);
      }
    }

    return json({
      status: "ok",
      emailCount: result.emailCount,
      summaryText: result.summaryText,
      periodStart: result.periodStart.toISOString(),
      periodEnd: result.periodEnd.toISOString(),
      discordSent,
    });
  } catch (err) {
    if (err instanceof SummaryError && err.code === "gemini") {
      return json({ error: "AI 摘要產生失敗，請稍後再試。" }, 502);
    }
    console.error("Manual summary failed:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
};
