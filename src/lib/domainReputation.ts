import { lookupDomains, type SafeBrowsingLookup } from "./safeBrowsing";
import type { DomainReputation, ReputationVerdict } from "./senderTrust";
import { normalizeDomain } from "./trustedDomains";

/**
 * 網域信譽快取層：以網域（而非寄件者）為單位，避免同一個 apple.com 被重複查詢。
 */

type SupabaseLike = { from: (table: string) => any };

const DAY_MS = 24 * 60 * 60 * 1000;
const CLEAN_TTL_MS = 7 * DAY_MS;
const THREAT_MIN_TTL_MS = 5 * 60 * 1000;
const THREAT_DEFAULT_TTL_MS = DAY_MS;
/** unknown／error 只短暫退避，避免暫時性故障長期卡住判定。 */
const DEGRADED_TTL_MS = 60 * 60 * 1000;

interface DomainReputationRow {
  domain: string;
  verdict: ReputationVerdict;
  threat_types: string[] | null;
  error_message: string | null;
  checked_at: string;
  expires_at: string;
}

function ttlMs(lookup: SafeBrowsingLookup): number {
  switch (lookup.verdict) {
    case "clean":
      return CLEAN_TTL_MS;
    case "threat":
      return lookup.cacheSeconds
        ? Math.max(lookup.cacheSeconds * 1000, THREAT_MIN_TTL_MS)
        : THREAT_DEFAULT_TTL_MS;
    default:
      return DEGRADED_TTL_MS;
  }
}

function toReputation(row: DomainReputationRow): DomainReputation {
  return {
    domain: row.domain,
    verdict: row.verdict,
    threatTypes: row.threat_types ?? [],
    checkedAt: row.checked_at,
    errorMessage: row.error_message,
  };
}

/**
 * 讀取網域信譽，快取未命中時才呼叫 Safe Browsing。
 * 外部查詢失敗時仍會回傳既有快取結果，缺項為 unknown —— 不會 throw。
 */
export async function getDomainReputations(
  supabase: SupabaseLike,
  domains: string[],
): Promise<Map<string, DomainReputation>> {
  const unique = [...new Set(domains.map((d) => normalizeDomain(d)).filter((d): d is string => !!d))];
  const results = new Map<string, DomainReputation>();
  if (unique.length === 0) return results;

  const now = new Date();
  const nowIso = now.toISOString();

  const { data } = await supabase
    .from("domain_reputation")
    .select("domain, verdict, threat_types, error_message, checked_at, expires_at")
    .in("domain", unique)
    .gt("expires_at", nowIso);

  for (const row of (data ?? []) as DomainReputationRow[]) {
    results.set(row.domain, toReputation(row));
  }

  const missing = unique.filter((domain) => !results.has(domain));
  if (missing.length === 0) return results;

  const lookups = await lookupDomains(missing);
  const rows: DomainReputationRow[] = [];

  for (const domain of missing) {
    const lookup = lookups.get(domain);
    if (!lookup) {
      results.set(domain, {
        domain,
        verdict: "unknown",
        threatTypes: [],
        checkedAt: nowIso,
        errorMessage: "外部信譽查詢未回傳此網域結果",
      });
      continue;
    }

    const row: DomainReputationRow = {
      domain,
      verdict: lookup.verdict,
      threat_types: lookup.threatTypes,
      error_message: lookup.errorMessage,
      checked_at: nowIso,
      expires_at: new Date(now.getTime() + ttlMs(lookup)).toISOString(),
    };
    rows.push(row);
    results.set(domain, toReputation(row));
  }

  if (rows.length > 0) {
    // 只有「不存在或已過期」的網域會走到這裡，故直接覆寫不會蓋掉仍有效的判定。
    const { error } = await supabase
      .from("domain_reputation")
      .upsert(
        rows.map((row) => ({ ...row, provider: "google_safe_browsing", updated_at: nowIso })) as never,
        { onConflict: "domain" },
      );
    if (error) console.error("寫入網域信譽快取失敗", error);
  }

  return results;
}
