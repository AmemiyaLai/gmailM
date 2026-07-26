export interface AnalyticsEmail {
  sender: string;
  received_at: string;
  category: string | null;
  is_read: boolean;
  is_important: boolean | null;
  subject: string | null;
  snippet: string | null;
  body_plain: string | null;
}

export type AnalyticsRangePreset = "all" | "7d" | "30d" | "90d" | "custom";

export interface AnalyticsRange {
  preset: AnalyticsRangePreset;
  from?: string;
  to?: string;
}

export interface AnalyticsResult {
  summary: { total: number; dailyAverage: number; unread: number; unreadRate: number; important: number };
  trend: { bucket: "day" | "month"; items: { label: string; count: number }[] };
  hours: { label: string; count: number }[];
  weekdays: { label: string; count: number }[];
  categories: { label: string; count: number }[];
  senders: { sender: string; count: number; dailyAverage: number; latestReceivedAt: string }[];
  keywords: { label: string; count: number }[];
}

const taipeiFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short",
});
const weekdayLabels = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];
const stopWords = new Set([
  "the", "and", "for", "that", "this", "with", "from", "your", "you", "are", "was", "will", "have", "has", "not", "into", "our", "please", "via", "re", "fw",
  "的", "了", "是", "在", "有", "和", "與", "及", "或", "請", "您", "你", "我", "我們", "通知", "您好", "一封", "郵件", "內容", "查看", "使用", "進行", "已經", "可以",
]);

function taipeiParts(value: string | Date): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of taipeiFormatter.formatToParts(new Date(value))) parts[part.type] = part.value;
  return parts;
}

function taipeiDate(value: string | Date): string {
  const p = taipeiParts(value);
  return `${p.year}-${p.month}-${p.day}`;
}

function isDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function parseAnalyticsRange(url: URL, now = new Date()): AnalyticsRange {
  const preset = url.searchParams.get("range") as AnalyticsRangePreset | null;
  const validPreset: AnalyticsRangePreset = ["all", "7d", "30d", "90d", "custom"].includes(preset ?? "") ? preset! : "all";
  if (validPreset === "all") return { preset: "all" };
  if (validPreset === "custom") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (isDate(from) && isDate(to) && from <= to) return { preset: "custom", from, to };
    return { preset: "all" };
  }
  const days = Number.parseInt(validPreset, 10);
  const today = taipeiDate(now);
  return { preset: validPreset, from: addDays(today, -(days - 1)), to: today };
}

export function rangeToQueryBounds(range: AnalyticsRange | Pick<AnalyticsRange, "from" | "to">): { from?: string; to?: string } {
  if (!range.from || !range.to) return {};
  // 台北午夜為前一日 16:00 UTC；to 採用下一天午夜前的開區間，查詢端以 lt 使用。
  return { from: `${range.from}T00:00:00+08:00`, to: `${addDays(range.to, 1)}T00:00:00+08:00` };
}

function countDays(range: AnalyticsRange, emails: AnalyticsEmail[]): number {
  if (range.from && range.to) return Math.max(1, Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1);
  if (!emails.length) return 1;
  const dates = emails.map((email) => taipeiDate(email.received_at)).sort();
  return Math.max(1, Math.round((Date.parse(`${dates.at(-1)}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 86_400_000) + 1);
}

function extractKeywords(text: string): string[] {
  const cleaned = text.replace(/https?:\/\/\S+|www\.\S+/giu, " ").toLocaleLowerCase("zh-TW");
  const Segmenter = Intl.Segmenter;
  const segments = Segmenter
    ? [...new Segmenter("zh-TW", { granularity: "word" }).segment(cleaned)].filter((item) => item.isWordLike).map((item) => item.segment)
    : cleaned.split(/[^\p{L}]+/u);
  return segments.filter((word) => {
    const normalized = word.trim();
    const cjk = /[\u3400-\u9fff]/u.test(normalized);
    return !stopWords.has(normalized) && !/^\d+$/u.test(normalized) && (cjk ? normalized.length >= 2 : normalized.length >= 3);
  });
}

export function buildEmailAnalytics(emails: AnalyticsEmail[], range: AnalyticsRange): AnalyticsResult {
  const dayCount = countDays(range, emails);
  const trendBucket: "day" | "month" = dayCount <= 90 ? "day" : "month";
  const trend = new Map<string, number>();
  const categories = new Map<string, number>();
  const senders = new Map<string, { count: number; latestReceivedAt: string }>();
  const keywords = new Map<string, number>();
  const hours = Array.from({ length: 24 }, () => 0);
  const weekdays = Array.from({ length: 7 }, () => 0);
  let unread = 0;
  let important = 0;

  for (const email of emails) {
    const parts = taipeiParts(email.received_at);
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    const bucket = trendBucket === "day" ? day : day.slice(0, 7);
    trend.set(bucket, (trend.get(bucket) ?? 0) + 1);
    hours[Number(parts.hour)]++;
    const taipeiWeekday = new Date(new Date(email.received_at).getTime() + 8 * 60 * 60 * 1000).getUTCDay();
    const weekday = taipeiWeekday === 0 ? 6 : taipeiWeekday - 1;
    weekdays[weekday]++;
    const category = email.category || "uncategorized";
    categories.set(category, (categories.get(category) ?? 0) + 1);
    const sender = senders.get(email.sender);
    if (sender) {
      sender.count++;
      if (email.received_at > sender.latestReceivedAt) sender.latestReceivedAt = email.received_at;
    } else senders.set(email.sender, { count: 1, latestReceivedAt: email.received_at });
    if (!email.is_read) unread++;
    if (email.is_important) important++;
    for (const keyword of extractKeywords([email.subject, email.snippet, email.body_plain].filter(Boolean).join(" "))) keywords.set(keyword, (keywords.get(keyword) ?? 0) + 1);
  }

  return {
    summary: { total: emails.length, dailyAverage: emails.length / dayCount, unread, unreadRate: emails.length ? unread / emails.length : 0, important },
    trend: { bucket: trendBucket, items: [...trend].sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => ({ label, count })) },
    hours: hours.map((count, hour) => ({ label: `${String(hour).padStart(2, "0")}:00`, count })),
    weekdays: weekdays.map((count, index) => ({ label: weekdayLabels[index], count })),
    categories: [...categories].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
    senders: [...senders].map(([sender, info]) => ({ sender, ...info, dailyAverage: info.count / dayCount })).sort((a, b) => b.count - a.count || a.sender.localeCompare(b.sender)),
    keywords: [...keywords].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15).map(([label, count]) => ({ label, count })),
  };
}
