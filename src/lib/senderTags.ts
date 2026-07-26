import { normalizeSenderAddress } from "./senderAddress";

export const SENDER_TAGS = ["banking", "securities", "commerce", "development", "media", "learning", "travel", "security", "other"] as const;
export type SenderTag = typeof SENDER_TAGS[number];
export type SenderTagSource = "auto" | "manual";
export const OTHER_SENDER_TAG: SenderTag = "other";
export const SENDER_TAG_CONFIDENCE_THRESHOLD = 0.75;

export const senderTagLabels: Record<SenderTag, string> = {
  banking: "金融銀行", securities: "證券投資", commerce: "購物交易", development: "開發／AI",
  media: "媒體電子報", learning: "學習／工作", travel: "旅行服務", security: "帳號／安全", other: "其他通知",
};

export function senderKey(sender: string): string {
  return normalizeSenderAddress(sender) ?? sender.trim().replace(/\s+/g, " ").toLowerCase();
}

const ruleSets: Array<{ tag: SenderTag; terms: string[] }> = [
  { tag: "securities", terms: ["證券", "securities", "brokerage", "投資", "期貨", "stock", "cathaysec", "sinotrade", "esunsec"] },
  { tag: "banking", terms: ["銀行", "bank", "financial", "cathaybk", "esunbank", "hsbc", "fubon", "paypal", "stripe"] },
  { tag: "commerce", terms: ["蝦皮", "shopee", "購物", "shop", "pxmart", "pxgo", "momo", "amazon", "coupang", "paddle"] },
  { tag: "development", terms: ["github", "gitlab", "vercel", "oracle cloud", "openai", "anthropic", "huggingface", "langchain", "n8n", "notion", "ai"] },
  { tag: "media", terms: ["電子報", "newsletter", "digest", "媒體", "udnpaper", "vocus", "dezeen", "substack"] },
  { tag: "learning", terms: ["學習", "課程", "教育", "學校", "ntu", "duolingo", "grammarly", "家教", "teacher"] },
  { tag: "travel", terms: ["trip.com", "agoda", "旅行", "旅遊", "uber", "航空", "hotel"] },
  { tag: "security", terms: ["security", "安全", "verify", "防護", "protection", "登入", "帳號", "idprotect"] },
];

export function classifySenderTagByRule(input: { sender: string; subject?: string; snippet?: string }): { tag: SenderTag; confidence: number } | null {
  const text = [input.sender, input.subject ?? "", input.snippet ?? ""].join(" ").toLowerCase();
  const matched = ruleSets.find((rule) => rule.terms.some((term) => text.includes(term.toLowerCase())));
  return matched ? { tag: matched.tag, confidence: 0.95 } : null;
}

export function isSenderTag(value: unknown): value is SenderTag {
  return typeof value === "string" && (SENDER_TAGS as readonly string[]).includes(value);
}

export function aggregateRareAutoTags<T extends { tag: SenderTag; source: SenderTagSource; was_aggregated: boolean }>(rows: T[]): T[] {
  const counts = new Map<SenderTag, number>();
  for (const row of rows) if (row.tag !== OTHER_SENDER_TAG) counts.set(row.tag, (counts.get(row.tag) ?? 0) + 1);
  return rows.map((row) => row.source === "auto" && row.tag !== OTHER_SENDER_TAG && (counts.get(row.tag) ?? 0) < 2
    ? { ...row, tag: OTHER_SENDER_TAG, was_aggregated: true }
    : row);
}
