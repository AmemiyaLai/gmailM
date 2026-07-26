import type { APIRoute } from "astro";
import { getSupabase } from "../../../lib/supabase";
import { startWatch } from "../../../lib/gmail";

interface SyncStateRow {
  watch_address: string;
  last_history_id: number;
}

export const GET: APIRoute = async ({ request }) => {
  const authHeader = request.headers.get("authorization");
  const cronSecret = import.meta.env.CRON_SECRET;

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { historyId, expiration } = await startWatch();
    const supabase = getSupabase();

    const watchAddress = import.meta.env.GMAIL_WATCH_ADDRESS;

    const { data: existing } = await supabase
      .from("gmail_sync_state" as never)
      .select("last_history_id")
      .eq("watch_address", watchAddress)
      .single() as { data: SyncStateRow | null };

    const update: Record<string, unknown> = {
      watch_expiration: new Date(Number(expiration)).toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (!existing?.last_history_id) {
      update.last_history_id = Number(historyId);
    }

    await supabase
      .from("gmail_sync_state" as never)
      .upsert(
        { watch_address: watchAddress, ...update } as never,
        { onConflict: "watch_address" },
      );

    return new Response(
      JSON.stringify({ historyId, expiration }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Watch renew failed:", err);
    return new Response("Internal error", { status: 500 });
  }
};
