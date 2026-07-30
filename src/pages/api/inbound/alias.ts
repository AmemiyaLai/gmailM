import type { APIRoute } from "astro";
import { getSupabase } from "../../../lib/supabase";
import { updateAlias, type AliasPatch } from "../../../lib/inboundEmailService";

const ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_LABEL_LENGTH = 64;
const MAX_SITE_LENGTH = 128;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 編輯別名的顯示標籤／所屬站點等欄位（別名本身由收信自動登記，不可改名） */
export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "無效的 JSON" });
  }

  const alias = typeof body.alias === "string" ? body.alias.trim().toLowerCase() : "";
  if (!ALIAS_PATTERN.test(alias)) {
    return json(400, { error: "別名格式錯誤" });
  }

  const patch: AliasPatch = {};
  if (typeof body.label === "string") {
    const label = body.label.trim().slice(0, MAX_LABEL_LENGTH);
    if (label) patch.label = label;
  }
  if (typeof body.site === "string") {
    patch.site = body.site.trim().slice(0, MAX_SITE_LENGTH) || null;
  }
  if (typeof body.note === "string") {
    patch.note = body.note.trim() || null;
  }
  if (typeof body.color === "string") {
    patch.color = body.color.trim().slice(0, 16) || null;
  }
  if (typeof body.is_active === "boolean") {
    patch.is_active = body.is_active;
  }

  if (Object.keys(patch).length === 0) {
    return json(400, { error: "沒有可更新的欄位" });
  }

  try {
    const result = await updateAlias(getSupabase(), alias, patch);
    if (!result.found) {
      return json(404, { error: "找不到這個別名" });
    }
  } catch (error) {
    console.error("更新別名失敗:", error);
    return json(500, { error: "internal error" });
  }

  return json(200, { status: "ok" });
};
