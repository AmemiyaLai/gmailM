import type { APIRoute } from "astro";
import { getSupabase } from "../../../lib/supabase";
import { sendFirstSenderDigest } from "../../../lib/firstSender";
import { env } from "../../../lib/env";

/**
 * 由外部排程（GitHub Actions，每日 07:00 / 19:00 台北時間）帶
 * `Authorization: Bearer <CRON_SECRET>` 觸發，
 * 把累積的首次寄件者事件彙整成一則 Discord 摘要。
 */
export const GET: APIRoute = async ({ request }) => {
  if (request.headers.get("authorization") !== `Bearer ${env("CRON_SECRET")}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = getSupabase();
  try {
    const result = await sendFirstSenderDigest(supabase);
    return new Response(JSON.stringify({ status: "ok", pending: result.pending, sent: result.sent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("首次寄件者摘要發送失敗:", error);
    return new Response("Internal error", { status: 500 });
  }
};
