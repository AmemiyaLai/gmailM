import type { APIRoute } from "astro";
import { sendDiscordSummary } from "../../../lib/discord";
import { reconcileUnreadInbox, syncEmailsFromGmail } from "../../../lib/emailSync";
import { generateUnreadSummary, SummaryError } from "../../../lib/summaryService";
import { gmailAutomationPausedResponse, isGmailAutomationEnabled } from "../../../lib/gmailAutomation";
import { env } from "../../../lib/env";

// 每封信都是一次序列 Gmail 往返，50 封時實測整支端點要 38-47 秒，逼近 Vercel
// function 上限。webhook 才是即時進信的主路徑，這裡只是後備輪詢，20 封足夠。
const SYNC_LIMIT = 20;

function isQuietHours(): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
  return hour >= 1 && hour < 7;
}

export const GET: APIRoute = async ({ request }) => {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env("CRON_SECRET");

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!isGmailAutomationEnabled()) return gmailAutomationPausedResponse();

  let syncResult = { imported: 0, failed: 0 };
  try {
    syncResult = await syncEmailsFromGmail(SYNC_LIMIT);
    await reconcileUnreadInbox(SYNC_LIMIT);
  } catch (err) {
    console.error("Hourly summary: Gmail sync failed:", err);
  }

  if (isQuietHours()) {
    return new Response(
      JSON.stringify({ status: "skipped", reason: "quiet hours", sync: syncResult }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  let result;
  try {
    result = await generateUnreadSummary();
  } catch (err) {
    if (err instanceof SummaryError && err.code === "gemini") {
      return new Response("Gemini summarization failed", { status: 502 });
    }
    return new Response("Internal error", { status: 500 });
  }

  if (result.status === "skipped") {
    return new Response(
      JSON.stringify({ status: "skipped", reason: result.reason, sync: syncResult }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  await sendDiscordSummary({
    summaryText: result.summaryText,
    emailCount: result.emailCount,
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
  }).catch((err) => console.error("Hourly summary: Discord send failed:", err));

  return new Response(
    JSON.stringify({ status: "ok", emailCount: result.emailCount, sync: syncResult }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
