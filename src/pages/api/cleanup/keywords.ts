import type { APIRoute } from "astro";
import {
  addKeyword,
  deleteKeyword,
  isCleanupAction,
  isCleanupField,
  listKeywords,
  setKeywordEnabled,
} from "../../../lib/cleanupKeywords";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = async () => {
  return json({ keywords: await listKeywords() });
};

export const POST: APIRoute = async ({ request }) => {
  let keyword: unknown;
  let field: unknown;
  let action: unknown;
  try {
    const body = await request.json();
    keyword = body.keyword;
    field = body.field ?? "any";
    action = body.action ?? "trash";
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof keyword !== "string" || keyword.trim() === "") {
    return json({ error: "關鍵字不可為空" }, 400);
  }
  if (!isCleanupField(field)) {
    return json({ error: "無效的比對欄位" }, 400);
  }
  if (!isCleanupAction(action)) {
    return json({ error: "無效的動作類型" }, 400);
  }

  try {
    return json({ keyword: await addKeyword(keyword, field, action) }, 201);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "新增失敗" }, 400);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  let id: unknown;
  let enabled: unknown;
  try {
    const body = await request.json();
    id = body.id;
    enabled = body.enabled;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof id !== "string" || typeof enabled !== "boolean") {
    return json({ error: "缺少 id 或 enabled" }, 400);
  }

  try {
    await setKeywordEnabled(id, enabled);
    return json({ status: "ok" });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "更新失敗" }, 500);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  let id: unknown;
  try {
    const body = await request.json();
    id = body.id;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof id !== "string" || id === "") {
    return json({ error: "缺少 id" }, 400);
  }

  try {
    await deleteKeyword(id);
    return json({ status: "ok" });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "刪除失敗" }, 500);
  }
};
