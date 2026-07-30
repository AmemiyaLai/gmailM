import type { APIRoute } from "astro";
import { getSupabase } from "../../../lib/supabase";
import { sendInboundDigest } from "../../../lib/discord";
import { getInboundDigestStats } from "../../../lib/inboundEmailService";

/**
 * 站點收件匣 Discord 摘要。
 * 由外部排程（GitHub Actions，每日 07:00 / 19:00 台北時間）帶
 * `Authorization: Bearer <CRON_SECRET>` 觸發。
 * 摘要窗口 13 小時（12 小時排程間隔 + 1 小時重疊），cron 延遲也不漏信；
 * 重疊造成的少量重複只影響摘要顯示，無資料副作用。
 */
const DIGEST_WINDOW_MS = 13 * 60 * 60 * 1000;

export const GET: APIRoute = async ({ request }) => {
  if (request.headers.get("authorization") !== `Bearer ${import.meta.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - DIGEST_WINDOW_MS);

  let stats;
  try {
    stats = await getInboundDigestStats(getSupabase(), periodStart.toISOString());
  } catch (error) {
    console.error("站點收件匣摘要統計失敗:", error);
    return new Response("Internal error", { status: 500 });
  }

  if (stats.total === 0) {
    return new Response(JSON.stringify({ status: "skipped", reason: "no new inbound mail" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  await sendInboundDigest({ ...stats, periodStart, periodEnd }).catch((error) => {
    console.error("站點收件匣摘要 Discord 發送失敗:", error);
  });

  return new Response(JSON.stringify({ status: "ok", total: stats.total, unread: stats.unreadTotal }), {
    headers: { "Content-Type": "application/json" },
  });
};
