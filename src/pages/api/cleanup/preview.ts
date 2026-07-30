import type { APIRoute } from "astro";
import { isCleanupField, previewKeyword } from "../../../lib/cleanupKeywords";

/**
 * 即時預覽某個關鍵字目前會篩到哪些郵件。
 * 關鍵字尚未儲存也能查，供 /cleanup 頁面在輸入時顯示結果。
 */
export const GET: APIRoute = async ({ url }) => {
  const keyword = url.searchParams.get("keyword") ?? "";
  const fieldParam = url.searchParams.get("field") ?? "any";
  const field = isCleanupField(fieldParam) ? fieldParam : "any";

  if (keyword.trim() === "") {
    return new Response(JSON.stringify({ total: 0, emails: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await previewKeyword(keyword, field);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
