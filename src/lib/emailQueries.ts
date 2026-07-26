import { getSupabase } from "./supabase";
import { categories } from "./classify";

/**
 * 讀取的欄位/資料表（emails.is_important、email_summaries）來自
 * supabase/migrations/0004_gemini_features.sql，是已上線的真實 AI 摘要/重要性判斷功能，
 * 非佔位資料。
 */

export interface EmailPreview {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  received_at: string;
  is_read: boolean;
  category: string | null;
  is_important?: boolean;
}

export interface SummaryRow {
  id: string;
  summary_text: string;
  email_count: number;
  period_start: string;
  period_end: string;
  created_at: string;
}

const PREVIEW_COLUMNS = "id, sender, subject, snippet, received_at, is_read, category, is_important";

function startOfTodayTaipei(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;

  const utcMidnight = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), 0, 0, 0);
  return new Date(utcMidnight - 8 * 60 * 60 * 1000);
}

export async function getUnreadCount(): Promise<number> {
  const supabase = getSupabase();
  const { count } = await supabase
    .from("emails" as never)
    .select("id", { count: "exact", head: true })
    .eq("is_read", false);
  return count ?? 0;
}

export async function getTodayCount(): Promise<number> {
  const supabase = getSupabase();
  const { count } = await supabase
    .from("emails" as never)
    .select("id", { count: "exact", head: true })
    .gte("received_at", startOfTodayTaipei().toISOString());
  return count ?? 0;
}

export async function getCategoryCounts(): Promise<{ category: string; count: number }[]> {
  const supabase = getSupabase();
  const results = await Promise.all(
    categories.map(async (category) => {
      const { count } = await supabase
        .from("emails" as never)
        .select("id", { count: "exact", head: true })
        .eq("category", category);
      return { category, count: count ?? 0 };
    }),
  );
  return results;
}

export async function getRecentUnread(limit = 10): Promise<EmailPreview[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("emails" as never)
    .select(PREVIEW_COLUMNS)
    .eq("is_read", false)
    .order("received_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as EmailPreview[];
}

export async function getImportantEmails(limit = 5): Promise<EmailPreview[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("emails" as never)
    .select(PREVIEW_COLUMNS)
    .eq("is_important", true)
    .order("received_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as EmailPreview[];
}

export async function getLatestSummary(): Promise<SummaryRow | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("email_summaries" as never)
    .select("id, summary_text, email_count, period_start, period_end, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as SummaryRow | null;
}

export interface ListEmailsOptions {
  category?: string;
  onlyUnread?: boolean;
  onlyImportant?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListEmailsResult {
  emails: EmailPreview[];
  hasMore: boolean;
}

export async function listEmails(opts: ListEmailsOptions = {}): Promise<ListEmailsResult> {
  const { category, onlyUnread = false, onlyImportant = false, limit = 50, offset = 0 } = opts;
  const supabase = getSupabase();

  let query = supabase
    .from("emails" as never)
    .select(PREVIEW_COLUMNS)
    .order("received_at", { ascending: false })
    .range(offset, offset + limit);

  if (category) {
    query = query.eq("category", category);
  }
  if (onlyUnread) {
    query = query.eq("is_read", false);
  }
  if (onlyImportant) {
    query = query.eq("is_important", true);
  }

  const { data } = await query;
  const rows = (data ?? []) as EmailPreview[];
  const hasMore = rows.length > limit;
  return { emails: rows.slice(0, limit), hasMore };
}
