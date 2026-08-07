import type { APIRoute } from "astro";
import { reconcileUnreadInbox } from "../../../lib/emailSync";
import { classifyGmailApiError } from "../../../lib/gmail";
import { getSupabase } from "../../../lib/supabase";
import {
  acquireGmailSyncLease,
  clearGmailFailures,
  handleGmailSyncFailure,
  recordGmailCooldown,
  releaseGmailSyncLease,
} from "../../../lib/gmailSyncControl";
import { gmailAutomationPausedResponse, isGmailAutomationEnabled } from "../../../lib/gmailAutomation";
import { env } from "../../../lib/env";

const RECONCILE_BATCH_SIZE = 20;

export const POST: APIRoute = async () => {
  // Emergency traffic kill switch: do not even create a Supabase client / acquire a lease
  // while Gmail automation is paused. This also keeps a missing migration from causing 500s.
  if (!isGmailAutomationEnabled()) return gmailAutomationPausedResponse();

  const watchAddress = env("GMAIL_WATCH_ADDRESS");
  const supabase = getSupabase();
  const admission = watchAddress
    ? await acquireGmailSyncLease(supabase, watchAddress)
    : { status: "acquired" as const, token: null, retryAfter: null };
  if (admission.status !== "acquired") {
    return new Response(JSON.stringify({ status: admission.status, retryAfter: admission.retryAfter }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const result = await reconcileUnreadInbox(RECONCILE_BATCH_SIZE);
    if (watchAddress) await clearGmailFailures(supabase, watchAddress).catch(() => undefined);
    return new Response(JSON.stringify({ status: result.completed ? "ok" : "reconciling", ...result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const info = classifyGmailApiError(err);
    if (info.rateLimited && watchAddress) {
      const retryAfter = info.retryAfter ?? new Date(Date.now() + 15 * 60_000);
      await recordGmailCooldown(supabase, watchAddress, retryAfter, info.message).catch(() => undefined);
      console.warn("gmail_rate_limited", { operation: "manualSync", retryAfter: retryAfter.toISOString() });
      return new Response(JSON.stringify({ status: "cooldown", retryAfter: retryAfter.toISOString() }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("gmail_manual_sync_failed", { status: info.status, message: info.message });
    await handleGmailSyncFailure(supabase, watchAddress, info.message, "manualSync");
    return new Response(
      JSON.stringify({ error: err instanceof Error ? info.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  } finally {
    if (watchAddress) await releaseGmailSyncLease(supabase, watchAddress, admission.token).catch(() => undefined);
  }
};
