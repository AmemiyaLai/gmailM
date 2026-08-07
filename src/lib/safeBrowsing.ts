import type { ReputationVerdict } from "./senderTrust";
import { normalizeDomain } from "./trustedDomains";
import { env } from "./env";

/**
 * Google Safe Browsing Lookup API v4 網域信譽查詢。
 *
 * 此模組只負責 fetch，不碰資料庫（快取層見 domainReputation.ts），
 * 且永遠不 throw —— 任何失敗都降級為 unknown／error，讓可信度判定照常完成。
 */

const ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find";
const THREAT_TYPES = [
  "MALWARE",
  "SOCIAL_ENGINEERING",
  "UNWANTED_SOFTWARE",
  "POTENTIALLY_HARMFUL_APPLICATION",
];
/** 單一請求最多送查的網域數（API 上限為 500，保守取 100）。 */
const BATCH_SIZE = 100;

export interface SafeBrowsingLookup {
  domain: string;
  verdict: ReputationVerdict;
  threatTypes: string[];
  /** 由 matches[].cacheDuration（如 "300s"）解析出的秒數 */
  cacheSeconds: number | null;
  errorMessage: string | null;
  raw: unknown;
}

interface ThreatMatch {
  threatType?: string;
  threat?: { url?: string };
  cacheDuration?: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function parseCacheDuration(value: string | undefined): number | null {
  const seconds = Number.parseFloat((value ?? "").replace(/s$/i, ""));
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
}

/** Safe Browsing 回傳的 threat.url 可能帶協定或路徑，取回註冊網域片段。 */
function domainFromThreatUrl(url: string | undefined): string | null {
  if (!url) return null;
  const withoutScheme = url.replace(/^[a-z]+:\/\//i, "");
  return normalizeDomain(withoutScheme.split("/")[0]);
}

function fallback(
  domains: string[],
  verdict: ReputationVerdict,
  errorMessage: string,
): Map<string, SafeBrowsingLookup> {
  return new Map(
    domains.map((domain) => [
      domain,
      { domain, verdict, threatTypes: [], cacheSeconds: null, errorMessage, raw: null },
    ]),
  );
}

async function lookupBatch(domains: string[], apiKey: string): Promise<Map<string, SafeBrowsingLookup>> {
  let payload: unknown;
  try {
    const response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client: { clientId: "gmail-monitor-panel", clientVersion: "1.0.0" },
        threatInfo: {
          threatTypes: THREAT_TYPES,
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: domains.map((domain) => ({ url: domain })),
        },
      }),
    });

    if (!response.ok) {
      const message =
        response.status === 429 || response.status === 403
          ? `外部信譽 API 配額不足（HTTP ${response.status}）`
          : `外部信譽 API 回應 HTTP ${response.status}`;
      return fallback(domains, "error", message);
    }

    payload = await response.json();
  } catch (error) {
    return fallback(domains, "error", error instanceof Error ? error.message : String(error));
  }

  const matches = ((payload as { matches?: ThreatMatch[] } | null)?.matches ?? []) as ThreatMatch[];
  const results = new Map<string, SafeBrowsingLookup>(
    // 未出現在 matches 的送查網域一律視為乾淨
    domains.map((domain) => [
      domain,
      { domain, verdict: "clean" as ReputationVerdict, threatTypes: [], cacheSeconds: null, errorMessage: null, raw: payload },
    ]),
  );

  for (const match of matches) {
    const domain = domainFromThreatUrl(match.threat?.url);
    const entry = domain ? results.get(domain) : undefined;
    if (!entry) continue;
    entry.verdict = "threat";
    if (match.threatType && !entry.threatTypes.includes(match.threatType)) {
      entry.threatTypes.push(match.threatType);
    }
    const seconds = parseCacheDuration(match.cacheDuration);
    if (seconds !== null) {
      entry.cacheSeconds = Math.max(entry.cacheSeconds ?? 0, seconds);
    }
  }

  return results;
}

/** 以網域為單位批量查詢信譽；永不 throw。 */
export async function lookupDomains(domains: string[]): Promise<Map<string, SafeBrowsingLookup>> {
  const unique = [...new Set(domains.map((d) => normalizeDomain(d)).filter((d): d is string => !!d))];
  if (unique.length === 0) return new Map();

  const apiKey = env("SAFE_BROWSING_API_KEY");
  if (!apiKey) {
    return fallback(unique, "unknown", "SAFE_BROWSING_API_KEY 未設定，略過外部信譽查詢");
  }

  const results = new Map<string, SafeBrowsingLookup>();
  // 循序送出，避免瞬時配額尖峰
  for (const batch of chunk(unique, BATCH_SIZE)) {
    const batchResults = await lookupBatch(batch, apiKey);
    for (const [domain, lookup] of batchResults) results.set(domain, lookup);
  }
  return results;
}
