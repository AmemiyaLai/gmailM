import type { APIRoute } from "astro";
import { getSupabase } from "../../../lib/supabase";
import { markAsRead, archiveMessage, trashMessage } from "../../../lib/gmail";

type BulkAction = "archive" | "trash" | "read";

const ACTION_FN: Record<BulkAction, (id: string) => Promise<void>> = {
  archive: archiveMessage,
  trash: trashMessage,
  read: markAsRead,
};

export const POST: APIRoute = async ({ request }) => {
  let ids: string[];
  let action: BulkAction;

  try {
    const body = await request.json();
    ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === "string") : [];
    action = body.action;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (ids.length === 0 || !(action in ACTION_FN)) {
    return new Response("Missing or invalid ids/action", { status: 400 });
  }

  const supabase = getSupabase();

  if (action === "read") {
    const { error } = await supabase.from("emails" as never).update({ is_read: true } as never).in("id", ids);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else {
    const { error } = await supabase.from("emails" as never).delete().in("id", ids);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const gmailFn = ACTION_FN[action];
  const results = await Promise.allSettled(ids.map((id) => gmailFn(id)));

  const gmailFailed: string[] = [];
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(`Bulk ${action}: Gmail sync failed for ${ids[i]}:`, result.reason);
      gmailFailed.push(ids[i]);
    }
  });

  return new Response(JSON.stringify({ succeeded: ids, gmailFailed }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
