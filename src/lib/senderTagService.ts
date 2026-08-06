import { judgeSenderTag } from "./gemini";
import { OTHER_SENDER_TAG, SENDER_TAG_CONFIDENCE_THRESHOLD, aggregateRareAutoTags, classifySenderTagByRule, isSenderTag, senderKey, type SenderTag, type SenderTagSource } from "./senderTags";

type Supabase = { from: (table: string) => any };
export interface SenderTagRow { sender_key: string; tag: SenderTag; source: SenderTagSource; confidence: number | null; was_aggregated: boolean; sender_display: string; updated_at: string; }
export interface SenderEmail { sender: string; sender_address?: string | null; subject?: string | null; snippet?: string | null; }

function keyForEmail(email: SenderEmail): string { return email.sender_address?.toLowerCase() || senderKey(email.sender); }

async function resolveAutoTag(email: SenderEmail): Promise<{ tag: SenderTag; confidence: number }> {
  const rule = classifySenderTagByRule({ sender: email.sender, subject: email.subject ?? undefined, snippet: email.snippet ?? undefined });
  if (rule) return rule;
  try {
    const result = await judgeSenderTag({ sender: email.sender, subject: email.subject ?? "", snippet: email.snippet ?? "" });
    if (isSenderTag(result.tag) && result.tag !== OTHER_SENDER_TAG && result.confidence >= SENDER_TAG_CONFIDENCE_THRESHOLD) return { tag: result.tag, confidence: result.confidence };
  } catch (error) { console.error("Sender tag judge failed:", error); }
  return { tag: OTHER_SENDER_TAG, confidence: 0 };
}

/** 寄件者標籤重算時單次讀取的郵件上限。 */
const MAX_SENDER_TAG_ROWS = 2000;

export async function refreshSenderTags(supabase: Supabase): Promise<{ processed: number; aggregated: number }> {
  // 全表掃描需有明確上限，否則郵件量成長後會放大 Supabase egress。
  const { data, error } = await supabase.from("emails").select("sender, sender_address, subject, snippet").limit(MAX_SENDER_TAG_ROWS);
  if (error) throw error;
  const groups = new Map<string, SenderEmail[]>();
  for (const email of (data ?? []) as SenderEmail[]) { const key = keyForEmail(email); if (key) groups.set(key, [...(groups.get(key) ?? []), email]); }
  const frequent = [...groups.entries()].filter(([, emails]) => emails.length >= 2);
  const { data: rows, error: tagsError } = await supabase.from("sender_tags").select("sender_key, tag, source, confidence, was_aggregated, sender_display, updated_at");
  if (tagsError) throw tagsError;
  const existing = new Map(((rows ?? []) as SenderTagRow[]).map((row) => [row.sender_key, row]));
  const candidates: SenderTagRow[] = [];
  for (const [key, emails] of frequent) {
    const old = existing.get(key);
    if (old?.source === "manual") { candidates.push(old); continue; }
    const resolved = old && !old.was_aggregated ? { tag: old.tag, confidence: old.confidence ?? 0 } : await resolveAutoTag(emails[0]);
    candidates.push({ sender_key: key, tag: resolved.tag, source: "auto", confidence: resolved.confidence, was_aggregated: false, sender_display: emails[0].sender, updated_at: new Date().toISOString() });
  }
  const saved = aggregateRareAutoTags(candidates);
  const aggregated = saved.filter((row, index) => row.was_aggregated && !candidates[index].was_aggregated).length;
  if (saved.length) { const { error: upsertError } = await supabase.from("sender_tags").upsert(saved, { onConflict: "sender_key" }); if (upsertError) throw upsertError; }
  return { processed: saved.length, aggregated };
}

export async function setManualSenderTag(supabase: Supabase, sender: string, tag: SenderTag): Promise<void> {
  const key = senderKey(sender);
  const { error } = await supabase.from("sender_tags").upsert({ sender_key: key, tag, source: "manual", confidence: null, was_aggregated: false, sender_display: sender, updated_at: new Date().toISOString() }, { onConflict: "sender_key" });
  if (error) throw error;
}

export async function getSenderTags(supabase: Supabase): Promise<Map<string, SenderTagRow>> {
  const { data, error } = await supabase.from("sender_tags").select("sender_key, tag, source, confidence, was_aggregated, sender_display, updated_at");
  if (error) {
    console.error("Unable to load sender tags:", error);
    return new Map();
  }
  return new Map(((data ?? []) as SenderTagRow[]).map((row) => [row.sender_key, row]));
}
