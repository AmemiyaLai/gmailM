import { getSupabase } from "./supabase";
import { categories } from "./classify";
import type { SenderGroup } from "./senderGroups";
import type { AnalyticsEmail, AnalyticsRange } from "./emailAnalytics";
import { rangeToQueryBounds } from "./emailAnalytics";
import { endOfTaipeiDate, startOfTaipeiDate } from "./emailFilters";
import type { AuthResult, TrustEvidence, TrustLevel } from "./senderTrust";
import { getInboxUnreadCount } from "./gmail";

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
  is_starred: boolean;
  is_first_sender: boolean;
}

export interface SummaryRow {
  id: string;
  summary_text: string;
  email_count: number;
  period_start: string;
  period_end: string;
  created_at: string;
}

export interface FirstSenderEventRow {
  sender_address: string;
  first_email_id: string;
  sender_display: string;
  first_received_at: string;
  source: "baseline" | "live";
  notification_status: "baseline" | "pending" | "failed" | "sent";
  notification_attempts: number;
  last_notification_error: string | null;
  notified_at: string | null;
  /** null 代表尚未評估安全狀態，見 supabase/migrations/0009_sender_trust.sql */
  trust_level: TrustLevel | null;
  spf_result: AuthResult | null;
  dkim_result: AuthResult | null;
  dmarc_result: AuthResult | null;
  auth_domain: string | null;
  trust_evidence: TrustEvidence[] | null;
  trust_evaluated_at: string | null;
}

const FIRST_SENDER_BASE_COLUMNS =
  "sender_address, first_email_id, sender_display, first_received_at, source, notification_status, notification_attempts, last_notification_error, notified_at";
const FIRST_SENDER_TRUST_COLUMNS =
  "trust_level, spf_result, dkim_result, dmarc_result, auth_domain, trust_evidence, trust_evaluated_at";

export async function getFirstSenderEvents(limit = 100): Promise<FirstSenderEventRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("first_sender_events" as never)
    .select(`${FIRST_SENDER_BASE_COLUMNS}, ${FIRST_SENDER_TRUST_COLUMNS}`)
    .order("first_received_at", { ascending: false })
    .limit(limit);
  if (!error) return (data ?? []) as FirstSenderEventRow[];

  // trust 欄位來自 0009_sender_trust.sql；migration 尚未套用時完整查詢會失敗。
  // 安全紀錄頁面是永久清單，不可因新欄位缺失而整頁變空，故退回基本欄位並記錄錯誤。
  console.error("getFirstSenderEvents 完整查詢失敗，退回基本欄位：", error.message);
  const fallback = await supabase
    .from("first_sender_events" as never)
    .select(FIRST_SENDER_BASE_COLUMNS)
    .order("first_received_at", { ascending: false })
    .limit(limit);
  if (fallback.error) {
    console.error("getFirstSenderEvents 基本欄位查詢也失敗：", fallback.error.message);
    return [];
  }
  return ((fallback.data ?? []) as Omit<FirstSenderEventRow, "trust_level" | "spf_result" | "dkim_result" | "dmarc_result" | "auth_domain" | "trust_evidence" | "trust_evaluated_at">[]).map((row) => ({
    ...row,
    trust_level: null,
    spf_result: null,
    dkim_result: null,
    dmarc_result: null,
    auth_domain: null,
    trust_evidence: null,
    trust_evaluated_at: null,
  }));
}

interface EmailPreviewRow {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  received_at: string;
  is_read: boolean;
  category: string | null;
  is_important?: boolean;
  labels: string[] | null;
  is_first_sender?: boolean;
}

const PREVIEW_COLUMNS = "id, sender, subject, snippet, received_at, is_read, category, is_important, is_first_sender, labels";

function toEmailPreview(row: EmailPreviewRow): EmailPreview {
  const { labels, ...rest } = row;
  return { ...rest, is_first_sender: rest.is_first_sender ?? false, is_starred: (labels ?? []).includes("STARRED") };
}

function toEmailPreviews(rows: EmailPreviewRow[]): EmailPreview[] {
  return rows.map(toEmailPreview);
}

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
    .from("unread_inbox_threads" as never)
    .select("id", { count: "exact", head: true });
  return count ?? 0;
}

export interface GmailUnreadStatus {
  count: number;
  source: "gmail" | "cache" | "database";
  updatedAt: string | null;
}

/** 避免每次頁面載入都打 Gmail API 導致觸發 429 User-rate limit exceeded。 */
const GMAIL_UNREAD_THROTTLE_MS = 30_000;
let gmailUnreadCache: { result: GmailUnreadStatus; checkedAt: number } | null = null;

/** 僅供測試重置節流快取，不應在正式程式碼中呼叫。 */
export function __resetGmailUnreadStatusThrottle() {
  gmailUnreadCache = null;
}

export async function getGmailUnreadStatus(): Promise<GmailUnreadStatus> {
  if (gmailUnreadCache && Date.now() - gmailUnreadCache.checkedAt < GMAIL_UNREAD_THROTTLE_MS) {
    return gmailUnreadCache.result;
  }

  const supabase = getSupabase();
  const watchAddress = import.meta.env.GMAIL_WATCH_ADDRESS;
  let result: GmailUnreadStatus | undefined;
  try {
    const count = await getInboxUnreadCount();
    const updatedAt = new Date().toISOString();
    if (watchAddress) {
      await supabase.from("gmail_sync_state" as never).upsert({
        watch_address: watchAddress,
        inbox_threads_unread: count,
        updated_at: updatedAt,
      } as never);
    }
    result = { count, source: "gmail", updatedAt };
  } catch (error) {
    console.error("讀取 Gmail 未讀討論串數失敗，改用同步快取：", error);
    if (watchAddress) {
      const { data } = await supabase
        .from("gmail_sync_state" as never)
        .select("inbox_threads_unread, updated_at")
        .eq("watch_address", watchAddress)
        .maybeSingle();
      const cached = data as { inbox_threads_unread?: number | null; updated_at?: string | null } | null;
      if (cached?.inbox_threads_unread !== null && cached?.inbox_threads_unread !== undefined) {
        result = { count: cached.inbox_threads_unread, source: "cache", updatedAt: cached.updated_at ?? null };
      }
    }
    if (!result) {
      result = { count: await getUnreadCount(), source: "database", updatedAt: null };
    }
  }

  gmailUnreadCache = { result, checkedAt: Date.now() };
  return result;
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

export type StatTrend = {
  direction: "up" | "down" | "flat";
  percentage: number | null;
};

export interface DashboardStatTrends {
  unread: StatTrend | null;
  today: StatTrend | null;
  groups: Record<string, StatTrend | null>;
  categories: Record<string, StatTrend | null>;
}

interface DashboardStatSnapshotRow {
  recorded_at: string;
  unread_count: number;
  today_count: number;
  group_counts: Record<string, number> | null;
  category_counts: Record<string, number> | null;
}

const DASHBOARD_SNAPSHOT_INTERVAL_MS = 30 * 60 * 1000;

function createStatTrend(current: number, previous: number): StatTrend {
  const difference = current - previous;
  return {
    direction: difference > 0 ? "up" : difference < 0 ? "down" : "flat",
    percentage: previous === 0 ? (current === 0 ? 0 : null) : Math.round((difference / previous) * 100),
  };
}

/**
 * 以儀表板上一筆快照計算漲跌，並每 30 分鐘保留一次目前數據。
 * 首次使用尚未有可比較的紀錄時，趨勢會回傳 null。
 */
export async function getDashboardStatTrends(
  unreadCount: number,
  todayCount: number,
  groupCounts: Record<string, number>,
  categoryCounts: Record<string, number>,
): Promise<DashboardStatTrends> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("dashboard_stat_snapshots" as never)
    .select("recorded_at, unread_count, today_count, group_counts, category_counts")
    .order("recorded_at", { ascending: false })
    .limit(1);

  const previous = ((data ?? [])[0] ?? null) as DashboardStatSnapshotRow | null;
  const now = new Date();

  if (!previous || now.getTime() - new Date(previous.recorded_at).getTime() >= DASHBOARD_SNAPSHOT_INTERVAL_MS) {
    await supabase.from("dashboard_stat_snapshots" as never).insert({
      recorded_at: now.toISOString(),
      unread_count: unreadCount,
      today_count: todayCount,
      group_counts: groupCounts,
      category_counts: categoryCounts,
    } as never);
  }

  return {
    unread: previous ? createStatTrend(unreadCount, previous.unread_count) : null,
    today: previous ? createStatTrend(todayCount, previous.today_count) : null,
    groups: Object.fromEntries(
      Object.entries(groupCounts).map(([group, count]) => [
        group,
        previous ? createStatTrend(count, previous.group_counts?.[group] ?? 0) : null,
      ]),
    ),
    categories: Object.fromEntries(
      Object.entries(categoryCounts).map(([category, count]) => [
        category,
        previous ? createStatTrend(count, previous.category_counts?.[category] ?? 0) : null,
      ]),
    ),
  };
}

export async function getImportantEmails(limit = 5): Promise<EmailPreview[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("emails" as never)
    .select(PREVIEW_COLUMNS)
    .eq("is_important", true)
    .order("received_at", { ascending: false })
    .limit(limit);
  return toEmailPreviews((data ?? []) as EmailPreviewRow[]);
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
  sender?: string;
  recipient?: string;
  from?: string;
  to?: string;
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
  const {
    category,
    sender,
    recipient,
    from,
    to,
    onlyUnread = false,
    onlyImportant = false,
    limit = 50,
    offset = 0,
  } = opts;
  const supabase = getSupabase();

  let query = supabase
    .from((onlyUnread ? "unread_inbox_threads" : "emails") as never)
    .select(PREVIEW_COLUMNS)
    .order("received_at", { ascending: false })
    .range(offset, offset + limit);

  if (category) {
    query = query.eq("category", category);
  }
  // unread_inbox_threads 已限定 INBOX + UNREAD，且每個 thread_id 只保留最新一封。
  if (onlyImportant) {
    query = query.eq("is_important", true);
  }
  if (sender) {
    query = query.ilike("sender", `%${sender}%`);
  }
  if (recipient) {
    query = query.ilike("recipient", `%${recipient}%`);
  }
  if (from) {
    query = query.gte("received_at", startOfTaipeiDate(from));
  }
  if (to) {
    query = query.lte("received_at", endOfTaipeiDate(to));
  }

  const { data } = await query;
  const rows = toEmailPreviews((data ?? []) as EmailPreviewRow[]);
  const hasMore = rows.length > limit;
  return { emails: rows.slice(0, limit), hasMore };
}

export interface SenderStat {
  sender: string;
  count: number;
  latestReceivedAt: string;
  categories: string[];
}

export async function getSenderStats(minCount = 2): Promise<SenderStat[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("emails" as never)
    .select("sender, category, received_at");

  const rows = (data ?? []) as { sender: string; category: string | null; received_at: string }[];
  const map = new Map<string, { count: number; latestReceivedAt: string; categories: Set<string> }>();

  for (const row of rows) {
    const existing = map.get(row.sender);
    if (existing) {
      existing.count++;
      if (row.received_at > existing.latestReceivedAt) {
        existing.latestReceivedAt = row.received_at;
      }
      if (row.category) existing.categories.add(row.category);
    } else {
      const categories = new Set<string>();
      if (row.category) categories.add(row.category);
      map.set(row.sender, { count: 1, latestReceivedAt: row.received_at, categories });
    }
  }

  const stats: SenderStat[] = [];
  for (const [sender, info] of map) {
    if (info.count >= minCount) {
      stats.push({
        sender,
        count: info.count,
        latestReceivedAt: info.latestReceivedAt,
        categories: Array.from(info.categories),
      });
    }
  }

  stats.sort((a, b) => b.count - a.count);
  return stats;
}

/**
 * 取得每個寄信者群組的未讀郵件數量。
 * "others" 群組以「總未讀 - 已匹配」差集計算。
 */
export async function getSenderGroupUnreadCounts(
  groups: SenderGroup[]
): Promise<Record<string, number>> {
  const supabase = getSupabase();

  // 取得所有未讀郵件的 sender 清單（不需要完整資料）
  const { data } = await supabase
    .from("unread_inbox_threads" as never)
    .select("sender");

  const senders: string[] = ((data ?? []) as { sender: string }[]).map(
    (r) => r.sender
  );

  const counts: Record<string, number> = {};
  let matchedCount = 0;

  for (const group of groups) {
    if (group.id === "others") continue;

    const count = senders.filter((sender) => {
      const lower = sender.toLowerCase();
      return group.patterns.some((p) => lower.includes(p));
    }).length;

    counts[group.id] = count;
    matchedCount += count;
  }

  // "others" = 全部未讀 - 已被其他群組匹配的郵件
  counts["others"] = Math.max(0, senders.length - matchedCount);

  return counts;
}

/**
 * 依群組 patterns 篩選未讀郵件，回傳郵件清單。
 * groupId 為 "others" 時，返回不匹配任何已知 group pattern 的未讀郵件。
 */
export async function listEmailsByGroup(
  groups: SenderGroup[],
  groupId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<ListEmailsResult> {
  const { limit = 50, offset = 0 } = opts;
  const supabase = getSupabase();

  const group = groups.find((g) => g.id === groupId);

  if (groupId !== "others" && group && group.patterns.length > 0) {
    // 正常群組：取出所有未讀郵件，在記憶體中過濾（Supabase JS SDK 不支援 OR ilike）
    const { data } = await supabase
      .from("unread_inbox_threads" as never)
      .select(PREVIEW_COLUMNS)
      .order("received_at", { ascending: false })
      .range(0, offset + limit + 500); // 多取一些以便過濾後仍有足夠資料

    const allRows = toEmailPreviews((data ?? []) as EmailPreviewRow[]);
    const filtered = allRows.filter((email) => {
      const lower = email.sender.toLowerCase();
      return group.patterns.some((p) => lower.includes(p));
    });

    const paged = filtered.slice(offset, offset + limit);
    return { emails: paged, hasMore: filtered.length > offset + limit };
  }

  if (groupId === "others") {
    // 「其他」群組：排除所有已匹配群組的 pattern
    const knownGroups = groups.filter((g) => g.id !== "others");
    const { data } = await supabase
      .from("unread_inbox_threads" as never)
      .select(PREVIEW_COLUMNS)
      .order("received_at", { ascending: false })
      .range(0, offset + limit + 500);

    const allRows = toEmailPreviews((data ?? []) as EmailPreviewRow[]);
    const filtered = allRows.filter((email) => {
      const lower = email.sender.toLowerCase();
      return !knownGroups.some((g) =>
        g.patterns.some((p) => lower.includes(p))
      );
    });

    const paged = filtered.slice(offset, offset + limit);
    return { emails: paged, hasMore: filtered.length > offset + limit };
  }

  return { emails: [], hasMore: false };
}

export interface TopSender {
  sender: string;
  count: number;
}

/**
 * 取得每個寄信者群組中，未讀郵件最多的前 N 名寄件者。
 * 一次查詢全部未讀 sender，在記憶體中分組計算，避免 N+1 查詢。
 */
export async function getSenderGroupTopSenders(
  groups: SenderGroup[],
  topN = 3
): Promise<Record<string, TopSender[]>> {
  const supabase = getSupabase();

  const { data } = await supabase
    .from("unread_inbox_threads" as never)
    .select("sender");

  const rows = (data ?? []) as { sender: string }[];

  // 計算每個 sender 的出現次數
  const senderCountMap = new Map<string, number>();
  for (const row of rows) {
    senderCountMap.set(row.sender, (senderCountMap.get(row.sender) ?? 0) + 1);
  }

  const knownGroups = groups.filter((g) => g.id !== "others");
  const result: Record<string, TopSender[]> = {};

  for (const group of groups) {
    if (group.id === "others") {
      // 「其他」群組：所有不匹配任何 pattern 的 sender
      const otherEntries = Array.from(senderCountMap.entries()).filter(
        ([sender]) => {
          const lower = sender.toLowerCase();
          return !knownGroups.some((g) =>
            g.patterns.some((p) => lower.includes(p))
          );
        }
      );
      otherEntries.sort((a, b) => b[1] - a[1]);
      result["others"] = otherEntries
        .slice(0, topN)
        .map(([sender, count]) => ({ sender, count }));
      continue;
    }

    const matched = Array.from(senderCountMap.entries()).filter(
      ([sender]) => {
        const lower = sender.toLowerCase();
        return group.patterns.some((p) => lower.includes(p));
      }
    );
    matched.sort((a, b) => b[1] - a[1]);
    result[group.id] = matched
      .slice(0, topN)
      .map(([sender, count]) => ({ sender, count }));
  }

  return result;
}

/**
 * 依分析期間取回所有郵件。Supabase 單次回傳上限為 1,000 筆，故採分頁讀取。
 * 僅讀取統計與關鍵詞分析需要的欄位，正文不會傳到瀏覽器。
 */
export async function getAnalyticsEmails(range: AnalyticsRange | Pick<AnalyticsRange, "from" | "to">): Promise<AnalyticsEmail[]> {
  const supabase = getSupabase();
  const pageSize = 1000;
  const all: AnalyticsEmail[] = [];
  const bounds = rangeToQueryBounds(range);

  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from("emails" as never)
      .select("sender, received_at, category, is_read, is_important, subject, snippet, body_plain")
      .order("received_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (bounds.from) query = query.gte("received_at", bounds.from);
    if (bounds.to) query = query.lt("received_at", bounds.to);
    const { data } = await query;
    const rows = (data ?? []) as AnalyticsEmail[];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}
