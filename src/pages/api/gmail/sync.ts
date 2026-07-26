import type { APIRoute } from "astro";
import { syncEmailsFromGmail } from "../../../lib/emailSync";

const MANUAL_SYNC_LIMIT = 50;

export const POST: APIRoute = async () => {
  try {
    const { imported, failed } = await syncEmailsFromGmail(MANUAL_SYNC_LIMIT);
    return new Response(JSON.stringify({ status: "ok", imported, failed }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Manual sync failed:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
