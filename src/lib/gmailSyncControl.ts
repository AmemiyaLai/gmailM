import { randomUUID } from "node:crypto";
import { getSupabase } from "./supabase";

export type SyncAdmissionStatus = "acquired" | "busy" | "cooldown" | "duplicate" | "baseline";

export interface SyncAdmission {
  status: SyncAdmissionStatus;
  token: string | null;
  lastHistoryId: number | null;
  retryAfter: string | null;
}

type SupabaseClient = ReturnType<typeof getSupabase>;

export async function acquireGmailSyncLease(
  supabase: SupabaseClient,
  watchAddress: string,
  notificationHistoryId?: string,
  leaseSeconds = 120,
): Promise<SyncAdmission> {
  const token = randomUUID();
  // Some unit-test doubles predate RPC support; production clients always expose rpc().
  if (typeof (supabase as { rpc?: unknown }).rpc !== "function") {
    return { status: "acquired", token, lastHistoryId: null, retryAfter: null };
  }
  const { data, error } = await supabase.rpc("acquire_gmail_sync_lease" as never, {
    p_watch_address: watchAddress,
    p_processing_token: token,
    p_notification_history_id: notificationHistoryId ? Number(notificationHistoryId) : null,
    p_lease_seconds: leaseSeconds,
  } as never);
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as {
    status?: SyncAdmissionStatus;
    last_history_id?: number | null;
    retry_after?: string | null;
  } | null;
  return {
    status: row?.status ?? "busy",
    token: row?.status === "acquired" ? token : null,
    lastHistoryId: row?.last_history_id ?? null,
    retryAfter: row?.retry_after ?? null,
  };
}

export async function releaseGmailSyncLease(
  supabase: SupabaseClient,
  watchAddress: string,
  token: string | null,
): Promise<void> {
  if (!token) return;
  const { error } = await supabase
    .from("gmail_sync_state" as never)
    .update({ processing_token: null, processing_until: null } as never)
    .eq("watch_address", watchAddress)
    .eq("processing_token", token);
  if (error) throw error;
}

export async function recordGmailCooldown(
  supabase: SupabaseClient,
  watchAddress: string,
  retryAfter: Date,
  errorMessage: string,
): Promise<void> {
  const { error } = await supabase.from("gmail_sync_state" as never).upsert({
    watch_address: watchAddress,
    cooldown_until: retryAfter.toISOString(),
    last_sync_error: errorMessage.slice(0, 500),
    updated_at: new Date().toISOString(),
  } as never);
  if (error) throw error;
}
