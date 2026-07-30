/**
 * 本地維護的知名網域白名單。
 *
 * 注意：命中白名單「只能讓安全等級提升一級」，永遠不能單獨造就「可信」判定。
 * 偽造 From 顯示網域是零成本的，因此 matchTrustedDomain() 的比對對象必須是
 * 通過 SPF/DKIM/DMARC 對齊的網域（見 senderTrust.resolveAuthDomain），
 * 而非郵件宣稱的寄件地址網域。
 */
export interface TrustedDomain {
  /** 小寫、不含前導點的註冊網域。 */
  domain: string;
  /** 中文顯示名稱，用於證據列的連結文字。 */
  label: string;
  /** 可點擊的依據來源（官方網域）。 */
  reference: string;
}

export const TRUSTED_DOMAINS: readonly TrustedDomain[] = [
  { domain: "apple.com", label: "Apple", reference: "https://www.apple.com/" },
  { domain: "google.com", label: "Google", reference: "https://www.google.com/" },
  { domain: "microsoft.com", label: "Microsoft", reference: "https://www.microsoft.com/" },
  { domain: "github.com", label: "GitHub", reference: "https://github.com/" },
  { domain: "paypal.com", label: "PayPal", reference: "https://www.paypal.com/" },
  { domain: "amazon.com", label: "Amazon", reference: "https://www.amazon.com/" },
  { domain: "line.me", label: "LINE", reference: "https://line.me/" },
  { domain: "cloudflare.com", label: "Cloudflare", reference: "https://www.cloudflare.com/" },
  { domain: "vercel.com", label: "Vercel", reference: "https://vercel.com/" },
  { domain: "supabase.com", label: "Supabase", reference: "https://supabase.com/" },
  { domain: "gov.tw", label: "中華民國政府機關", reference: "https://www.gov.tw/" },
  { domain: "edu.tw", label: "臺灣學術機構", reference: "https://www.edu.tw/" },
];

/** 正規化網域：去空白、轉小寫、移除 FQDN 尾點。 */
export function normalizeDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const normalized = domain.trim().toLowerCase().replace(/\.+$/, "");
  return normalized.length > 0 ? normalized : null;
}

/**
 * 以「.」邊界比對白名單；多筆命中時取最具體（網域最長）者。
 * notapple.com 不得命中 apple.com。
 */
export function matchTrustedDomain(domain: string | null | undefined): TrustedDomain | null {
  const target = normalizeDomain(domain);
  if (!target) return null;

  let matched: TrustedDomain | null = null;
  for (const entry of TRUSTED_DOMAINS) {
    if (target !== entry.domain && !target.endsWith(`.${entry.domain}`)) continue;
    if (!matched || entry.domain.length > matched.domain.length) {
      matched = entry;
    }
  }
  return matched;
}
