import type { APIRoute } from "astro";
import { getSupabase } from "../../../lib/supabase";
import { setManualSenderTag } from "../../../lib/senderTagService";
import { isSenderTag } from "../../../lib/senderTags";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as { sender?: string; tag?: unknown };
    if (!body.sender || !isSenderTag(body.tag)) return new Response("Invalid sender or tag", { status: 400 });
    await setManualSenderTag(getSupabase(), body.sender, body.tag);
    return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Update failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
