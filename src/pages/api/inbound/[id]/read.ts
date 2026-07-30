import type { APIRoute } from "astro";
import { getSupabase } from "../../../../lib/supabase";
import { markInboundRead } from "../../../../lib/inboundEmailService";

/** 切換站點郵件的已讀狀態；與 Gmail 無關，僅更新本地資料庫 */
export const PATCH: APIRoute = async ({ params, request }) => {
  const { id } = params;
  if (!id) {
    return new Response("缺少郵件 id", { status: 400 });
  }

  let read = true;
  try {
    const body = (await request.json()) as { read?: boolean };
    if (typeof body?.read === "boolean") read = body.read;
  } catch {
    // 無 body 或非 JSON 時視為標記已讀
  }

  try {
    await markInboundRead(getSupabase(), id, read);
  } catch (error) {
    console.error("更新站點郵件已讀狀態失敗:", error);
    return new Response("Internal error", { status: 500 });
  }

  return new Response(JSON.stringify({ status: "ok", read }), {
    headers: { "Content-Type": "application/json" },
  });
};
