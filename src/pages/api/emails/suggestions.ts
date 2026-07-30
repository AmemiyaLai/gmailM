import type { APIRoute } from "astro";
import { getSupabase } from "../../../lib/supabase";

interface SuggestedEmail {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
}

/** 供頂層搜尋框使用的輕量即時郵件候選清單。 */
export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return Response.json({ emails: [] });
  }

  const { data, error } = await getSupabase()
    .from("emails" as never)
    .select("id, sender, subject, snippet")
    .textSearch("search_vector", query, { type: "plain", config: "simple" })
    .order("received_at", { ascending: false })
    .limit(6);

  if (error) {
    return Response.json({ error: "搜尋候選郵件失敗" }, { status: 500 });
  }

  return Response.json({ emails: (data ?? []) as SuggestedEmail[] });
};
