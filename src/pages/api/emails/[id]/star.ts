import type { APIRoute } from "astro";
import { getSupabase } from "../../../../lib/supabase";
import { setStarred } from "../../../../lib/gmail";

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) {
    return new Response("Missing id", { status: 400 });
  }

  let starred: boolean;
  try {
    const body = await request.json();
    starred = Boolean(body.starred);
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const supabase = getSupabase();
  const { data: row, error: fetchError } = await supabase
    .from("emails" as never)
    .select("labels")
    .eq("id", id)
    .single();

  if (fetchError || !row) {
    return new Response(JSON.stringify({ error: fetchError?.message ?? "Email not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const currentLabels: string[] = (row as { labels: string[] | null }).labels ?? [];
  const newLabels = starred
    ? Array.from(new Set([...currentLabels, "STARRED"]))
    : currentLabels.filter((label) => label !== "STARRED");

  const { error } = await supabase
    .from("emails" as never)
    .update({ labels: newLabels } as never)
    .eq("id", id);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await setStarred(id, starred);
  } catch (err) {
    console.error(`Failed to sync star status to Gmail for ${id}:`, err);
    return new Response(
      JSON.stringify({
        status: "recorded",
        gmailSync: "failed",
        gmailError: err instanceof Error ? err.message : String(err),
      }),
      { status: 207, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
