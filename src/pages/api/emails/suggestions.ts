import type { APIRoute } from "astro";
import { buildEmailSearchPatterns } from "../../../lib/emailSearch";
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

  let search = getSupabase()
    .from("emails" as never)
    .select("id, sender, subject, snippet")
    .order("received_at", { ascending: false });

  for (const pattern of buildEmailSearchPatterns(query)) {
    search = search.ilike("search_text", pattern);
  }

  const { data, error } = await search.limit(6);

  if (error) {
    return Response.json({ error: "搜尋候選郵件失敗" }, { status: 500 });
  }

  return Response.json({ emails: (data ?? []) as SuggestedEmail[] });
};
