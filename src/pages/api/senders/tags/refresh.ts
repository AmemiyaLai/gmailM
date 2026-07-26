import type { APIRoute } from "astro";
import { getSupabase } from "../../../../lib/supabase";
import { refreshSenderTags } from "../../../../lib/senderTagService";

export const GET: APIRoute = async () => {
  const { data, error } = await getSupabase().from("sender_tags" as never)
    .select("sender_key, tag, source, confidence, was_aggregated, sender_display, updated_at")
    .order("updated_at", { ascending: false });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  return new Response(JSON.stringify({ tags: data ?? [] }), { headers: { "Content-Type": "application/json" } });
};

export const POST: APIRoute = async () => {
  try {
    const result = await refreshSenderTags(getSupabase());
    return new Response(JSON.stringify({ status: "ok", ...result }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Refresh failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
