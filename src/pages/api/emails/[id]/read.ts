import type { APIRoute } from "astro";
import { getSupabase } from "../../../../lib/supabase";
import { markAsRead } from "../../../../lib/gmail";

export const PATCH: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) {
    return new Response("Missing id", { status: 400 });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("emails" as never)
    .update({ is_read: true } as never)
    .eq("id", id);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await markAsRead(id);
  } catch (err) {
    console.error(`Failed to sync read status to Gmail for ${id}:`, err);
    return new Response(
      JSON.stringify({ status: "recorded", gmailSync: "failed" }),
      { status: 207, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ status: "ok" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
