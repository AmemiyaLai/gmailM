import type { APIRoute } from "astro";
import { syncEmailsFromGmail } from "../../../lib/emailSync";
import { env } from "../../../lib/env";

export const GET: APIRoute = async ({ request, url }) => {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env("CRON_SECRET");

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const maxResults = Math.min(
    1000,
    Number(url.searchParams.get("limit")) || 50,
  );

  try {
    const { imported, failed } = await syncEmailsFromGmail(maxResults);

    return new Response(
      JSON.stringify({ status: "ok", imported, failed, requested: maxResults }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Backfill failed:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
