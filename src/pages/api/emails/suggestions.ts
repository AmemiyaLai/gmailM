import type { APIRoute } from "astro";
import {
  buildEmailSearchFallbackFilters,
  buildEmailSearchPatterns,
  isMissingEmailSearchTextColumn,
} from "../../../lib/emailSearch";
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

  const supabase = getSupabase();
  const buildSearch = (useSearchText: boolean) => {
    let search = supabase
      .from("emails" as never)
      .select("id, sender, subject, snippet")
      .order("received_at", { ascending: false });

    if (useSearchText) {
      for (const pattern of buildEmailSearchPatterns(query)) {
        search = search.ilike("search_text", pattern);
      }
    } else {
      for (const filter of buildEmailSearchFallbackFilters(query)) {
        search = search.or(filter);
      }
    }

    return search.limit(6);
  };

  let result = await buildSearch(true);
  if (isMissingEmailSearchTextColumn(result.error)) {
    result = await buildSearch(false);
  }

  const { data, error } = result;

  if (error) {
    return Response.json({ error: "搜尋候選郵件失敗" }, { status: 500 });
  }

  return Response.json({ emails: (data ?? []) as SuggestedEmail[] });
};
