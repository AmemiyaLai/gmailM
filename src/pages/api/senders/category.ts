import type { APIRoute } from "astro";
import { getSupabase } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request }) => {
  let sender: string;
  let category: string;

  try {
    const body = await request.json();
    sender = body.sender;
    category = body.category;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (!sender || !category) {
    return new Response("Missing sender or category", { status: 400 });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("emails" as never)
    .update({ category } as never)
    .eq("sender", sender);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
