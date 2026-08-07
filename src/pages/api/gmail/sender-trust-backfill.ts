import type { APIRoute } from "astro";
import { getSupabase } from "../../../lib/supabase";
import { backfillSenderTrust } from "../../../lib/senderTrustService";
import { env } from "../../../lib/env";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const GET: APIRoute = async ({ request, url }) => {
  if (request.headers.get("authorization") !== `Bearer ${env("CRON_SECRET")}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const requested = Number(url.searchParams.get("limit"));
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(requested) && requested > 0 ? Math.trunc(requested) : DEFAULT_LIMIT),
  );
  // force 用於判定規則改版後全量重評；完全不呼叫 Gmail，只重跑既有標頭。
  const force = url.searchParams.get("force") === "true";

  try {
    const result = await backfillSenderTrust(getSupabase(), { limit, force });
    return new Response(JSON.stringify({ status: "ok", ...result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("回填寄件者安全狀態失敗", error);
    return new Response("Internal error", { status: 500 });
  }
};
