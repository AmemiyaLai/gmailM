import { getSupabase, unwrapQuery } from "./supabase";

/**
 * 使用者自訂的清理關鍵字（cleanup_keywords，見 supabase/migrations/0007_cleanup_keywords.sql）。
 * 每個關鍵字綁定一個 action：命中後該怎麼處理（trash＝移到垃圾桶／read＝標記已讀）。
 * 命中的郵件依 action 分開彙整成審核訊息，送到 Discord，確認後才會實際動作。
 */

export const CLEANUP_FIELDS = ["any", "subject", "sender", "snippet"] as const;
export type CleanupField = typeof CLEANUP_FIELDS[number];

export const cleanupFieldLabels: Record<CleanupField, string> = {
  any: "任意欄位",
  subject: "主旨",
  sender: "寄件者",
  snippet: "摘要",
};

export const CLEANUP_ACTIONS = ["trash", "read"] as const;
export type CleanupAction = typeof CLEANUP_ACTIONS[number];

export const cleanupActionLabels: Record<CleanupAction, string> = {
  trash: "移到垃圾桶",
  read: "標記已讀",
};

export interface CleanupKeyword {
  id: string;
  keyword: string;
  field: CleanupField;
  action: CleanupAction;
  enabled: boolean;
}

/** 比對用的最小郵件形狀，與 emailQueries.EmailPreview 相容 */
export interface MatchableEmail {
  id: string;
  sender: string;
  subject: string | null;
  snippet: string | null;
  received_at?: string;
}

export interface CleanupMatch {
  email: MatchableEmail;
  keyword: string;
}

/** 單則審核最多涵蓋的郵件數 —— Discord interaction 需在 3 秒內回應，超出的候選留給下一輪 */
export const CLEANUP_REVIEW_LIMIT = 25;
/** cron 掃描的回溯天數 */
export const CLEANUP_SCAN_DAYS = 7;

export function isCleanupField(value: unknown): value is CleanupField {
  return typeof value === "string" && (CLEANUP_FIELDS as readonly string[]).includes(value);
}

export function isCleanupAction(value: unknown): value is CleanupAction {
  return typeof value === "string" && (CLEANUP_ACTIONS as readonly string[]).includes(value);
}

function fieldText(email: MatchableEmail, field: CleanupField): string {
  switch (field) {
    case "subject":
      return email.subject ?? "";
    case "sender":
      return email.sender ?? "";
    case "snippet":
      return email.snippet ?? "";
    case "any":
      return [email.sender ?? "", email.subject ?? "", email.snippet ?? ""].join(" ");
  }
}

/** 大小寫不敏感的子字串比對，與 senderTags.classifySenderTagByRule 的慣例一致 */
export function matchKeyword(email: MatchableEmail, keyword: Pick<CleanupKeyword, "keyword" | "field">): boolean {
  const term = keyword.keyword.trim().toLowerCase();
  if (!term) return false;
  return fieldText(email, keyword.field).toLowerCase().includes(term);
}

/**
 * 純函式：找出命中任一啟用中關鍵字的郵件（不分 action，呼叫端自行依 keywords 篩選 action）。
 * 同一封郵件只回傳一次，記錄第一個命中的關鍵字。
 */
export function matchEmails(
  emails: MatchableEmail[],
  keywords: Pick<CleanupKeyword, "keyword" | "field" | "enabled">[],
): CleanupMatch[] {
  const active = keywords.filter((k) => k.enabled !== false && k.keyword.trim() !== "");
  if (active.length === 0) return [];

  const matches: CleanupMatch[] = [];
  const seen = new Set<string>();

  for (const email of emails) {
    if (seen.has(email.id)) continue;
    const hit = active.find((keyword) => matchKeyword(email, keyword));
    if (hit) {
      seen.add(email.id);
      matches.push({ email, keyword: hit.keyword });
    }
  }

  return matches;
}

const KEYWORD_COLUMNS = "id, keyword, field, action, enabled";
const MATCH_COLUMNS = "id, sender, subject, snippet, received_at";

export async function listKeywords(): Promise<CleanupKeyword[]> {
  const supabase = getSupabase();
  const result = await supabase
    .from("cleanup_keywords" as never)
    .select(KEYWORD_COLUMNS)
    .order("created_at", { ascending: true });
  return (unwrapQuery(result, "listKeywords") ?? []) as CleanupKeyword[];
}

export async function addKeyword(keyword: string, field: CleanupField, action: CleanupAction): Promise<CleanupKeyword> {
  const trimmed = keyword.trim();
  if (!trimmed) throw new Error("關鍵字不可為空");

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("cleanup_keywords" as never)
    .insert({ keyword: trimmed, field, action } as never)
    .select(KEYWORD_COLUMNS)
    .single();

  if (error) throw new Error(error.code === "23505" ? "這個關鍵字＋動作已經存在" : error.message);
  return data as unknown as CleanupKeyword;
}

export async function deleteKeyword(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("cleanup_keywords" as never).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setKeywordEnabled(id: string, enabled: boolean): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("cleanup_keywords" as never)
    .update({ enabled } as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * 取回指定期間內的郵件供記憶體比對。
 * Supabase JS SDK 不支援多欄位 OR ilike（見 emailQueries.listEmailsByGroup 的同樣做法），
 * 因此改為取回欄位後在記憶體比對。
 */
async function fetchRecentEmails(days: number, cap = 1000): Promise<MatchableEmail[]> {
  const supabase = getSupabase();
  const result = await supabase
    .from("emails" as never)
    .select(MATCH_COLUMNS)
    .gte("received_at", sinceIso(days))
    .order("received_at", { ascending: false })
    .limit(cap);
  return (unwrapQuery(result, "fetchRecentEmails") ?? []) as MatchableEmail[];
}

/**
 * 已在 pending / approved 審核單中的郵件 id，避免重複送審
 * （跨 action 共用一份，同一封信不會同時被兩種審核卡住）。
 *
 * 這支查詢失敗時必須拋出：靜默回傳空 Set 會讓已在審核中的郵件被重複送審。
 */
async function idsUnderReview(): Promise<Set<string>> {
  const supabase = getSupabase();
  const result = await supabase
    .from("cleanup_reviews" as never)
    .select("email_ids")
    .in("status", ["pending", "approved"]);

  const rows = (unwrapQuery(result, "idsUnderReview") ?? []) as { email_ids: string[] | null }[];
  const ids = new Set<string>();
  for (const row of rows) {
    for (const id of row.email_ids ?? []) ids.add(id);
  }
  return ids;
}

/**
 * 預覽單一關鍵字目前命中的郵件（供 /cleanup 頁面即時顯示，關鍵字尚未儲存也能查）。
 */
export async function previewKeyword(
  keyword: string,
  field: CleanupField,
  opts: { days?: number; limit?: number } = {},
): Promise<{ total: number; emails: MatchableEmail[] }> {
  const { days = 30, limit = 50 } = opts;
  const trimmed = keyword.trim();
  if (!trimmed) return { total: 0, emails: [] };

  const emails = await fetchRecentEmails(days);
  const matches = matchEmails(emails, [{ keyword: trimmed, field, enabled: true }]);
  return { total: matches.length, emails: matches.slice(0, limit).map((m) => m.email) };
}

/**
 * 找出本輪要送審的郵件：近 N 天內命中「指定 action 且啟用中」關鍵字、且尚未被其他審核單涵蓋的郵件。
 */
export async function findCandidates(
  action: CleanupAction,
  opts: { days?: number; limit?: number } = {},
): Promise<CleanupMatch[]> {
  const { days = CLEANUP_SCAN_DAYS, limit = CLEANUP_REVIEW_LIMIT } = opts;

  const keywords = (await listKeywords()).filter((k) => k.enabled && k.action === action);
  if (keywords.length === 0) return [];

  const [emails, reviewed] = await Promise.all([fetchRecentEmails(days), idsUnderReview()]);
  const fresh = emails.filter((email) => !reviewed.has(email.id));

  return matchEmails(fresh, keywords).slice(0, limit);
}
