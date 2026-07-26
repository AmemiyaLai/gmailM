import type { APIRoute } from "astro";
import { getSupabase } from "../../../../lib/supabase";
import { markAsRead, markAsUnread } from "../../../../lib/gmail";

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) {
    return new Response("Missing id", { status: 400 });
  }

  let read = true;
  try {
    const body = await request.json();
    if (typeof body.read === "boolean") {
      read = body.read;
    }
  } catch {
    // 若 body 無法解析或無 read 欄位，預設 true（向後相容）
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("emails" as never)
    .update({ is_read: read } as never)
    .eq("id", id);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    if (read) {
      await markAsRead(id);
    } else {
      await markAsUnread(id);
    }
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
