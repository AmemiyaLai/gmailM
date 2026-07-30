import { matchTrustedDomain, normalizeDomain } from "./trustedDomains";

/**
 * 寄件者可信度判定（純函式，不做任何 I/O）。
 *
 * 三個訊號：
 *   1. Gmail 寫入的 Authentication-Results 標頭（SPF / DKIM / DMARC）— 主判定
 *   2. Google Safe Browsing 網域信譽 — 只能定罪、不能單獨赦免
 *   3. 本地知名網域白名單 — 只能提升一級，且比對對象是通過驗證的對齊網域
 */

export type AuthResult =
  | "pass"
  | "fail"
  | "softfail"
  | "neutral"
  | "none"
  | "temperror"
  | "permerror"
  | "policy";

const AUTH_RESULTS: readonly AuthResult[] = [
  "pass",
  "fail",
  "softfail",
  "neutral",
  "none",
  "temperror",
  "permerror",
  "policy",
];

const AUTH_RESULT_LABELS: Record<AuthResult, string> = {
  pass: "通過",
  fail: "失敗",
  softfail: "軟性失敗",
  neutral: "中立",
  none: "未提供",
  temperror: "暫時性錯誤",
  permerror: "永久性錯誤",
  policy: "受政策限制",
};

export type TrustLevel = "trusted" | "likely" | "unverified" | "suspicious" | "dangerous";

export const TRUST_LEVEL_LABELS: Record<TrustLevel, string> = {
  trusted: "可信",
  likely: "大致可信",
  unverified: "未驗證",
  suspicious: "可疑",
  dangerous: "高風險",
};

/** 白名單升級用的階梯，僅作用於 unverified / likely。 */
const UPGRADE_LADDER: Partial<Record<TrustLevel, TrustLevel>> = {
  unverified: "likely",
  likely: "trusted",
};

export interface ParsedAuthResults {
  spf: AuthResult;
  dkim: AuthResult;
  dmarc: AuthResult;
  /** smtp.mailfrom= 的網域 */
  spfDomain: string | null;
  /** header.d= 或 header.i= 的網域 */
  dkimDomain: string | null;
  /** header.from= 的網域 */
  dmarcDomain: string | null;
  /** 標頭開頭的驗證主機識別（如 mx.google.com） */
  authservId: string | null;
  raw: string;
}

const EMPTY_PARSED: ParsedAuthResults = {
  spf: "none",
  dkim: "none",
  dmarc: "none",
  spfDomain: null,
  dkimDomain: null,
  dmarcDomain: null,
  authservId: null,
  raw: "",
};

function toAuthResult(value: string | undefined): AuthResult {
  const normalized = (value ?? "").trim().toLowerCase();
  return AUTH_RESULTS.includes(normalized as AuthResult) ? (normalized as AuthResult) : "none";
}

function domainFromValue(value: string | undefined): string | null {
  if (!value) return null;
  // header.i=@apple.com 或 smtp.mailfrom=user@apple.com 都只取 @ 之後
  const afterAt = value.includes("@") ? value.slice(value.lastIndexOf("@") + 1) : value;
  return normalizeDomain(afterAt);
}

/**
 * 解析 Authentication-Results 標頭。多筆標頭請先以 "\n" 串接後傳入。
 *
 * 每個 mechanism 只取「第一次出現」的值：最上方的標頭由自家 MX（mx.google.com）
 * 加上，最可信；下游轉寄者附加的在後面，不應覆蓋。
 */
export function parseAuthenticationResults(raw: string | null | undefined): ParsedAuthResults {
  const text = (raw ?? "").trim();
  if (!text) return { ...EMPTY_PARSED };

  const first: Partial<Record<"spf" | "dkim" | "dmarc", string>> = {};
  const pattern = /\b(spf|dkim|dmarc)\s*=\s*([a-z]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const mechanism = match[1].toLowerCase() as "spf" | "dkim" | "dmarc";
    if (first[mechanism] === undefined) first[mechanism] = match[2];
  }

  const authservId = text.split(";")[0]?.trim().split(/\s+/)[0] ?? null;

  return {
    spf: toAuthResult(first.spf),
    dkim: toAuthResult(first.dkim),
    dmarc: toAuthResult(first.dmarc),
    spfDomain: domainFromValue(text.match(/smtp\.mailfrom\s*=\s*([^\s;()]+)/i)?.[1]),
    dkimDomain: domainFromValue(text.match(/header\.(?:d|i)\s*=\s*@?([^\s;()]+)/i)?.[1]),
    dmarcDomain: domainFromValue(text.match(/header\.from\s*=\s*([^\s;()]+)/i)?.[1]),
    authservId: authservId && authservId.length > 0 ? authservId : null,
    raw: text,
  };
}

/** Received-SPF 後備解析，僅在 Authentication-Results 沒有 spf= 時使用。 */
export function parseReceivedSpf(raw: string | null | undefined): AuthResult {
  const text = (raw ?? "").trim();
  if (!text) return "none";
  return toAuthResult(text.split(/[\s(]/)[0]);
}

/** 取出郵件地址的網域部分。 */
export function senderDomain(senderAddress: string | null | undefined): string | null {
  if (!senderAddress || !senderAddress.includes("@")) return null;
  return normalizeDomain(senderAddress.slice(senderAddress.lastIndexOf("@") + 1));
}

/**
 * 取得「通過驗證的對齊網域」，找不到時回傳 null。
 * 這是白名單比對唯一允許的輸入 —— 絕不可退回未經驗證的 From 網域。
 */
export function resolveAuthDomain(
  senderAddress: string,
  parsed: ParsedAuthResults,
): string | null {
  if (parsed.dmarc === "pass" && parsed.dmarcDomain) return parsed.dmarcDomain;
  if (parsed.dkim === "pass" && parsed.dkimDomain) return parsed.dkimDomain;
  if (parsed.spf === "pass" && parsed.spfDomain) return parsed.spfDomain;
  if (parsed.dmarc === "pass") return senderDomain(senderAddress);
  return null;
}

/**
 * 取得信譽查詢用的網域。信譽查的是「這個網域本身是否惡意」，
 * 與郵件是否偽造無關，因此可退回 From 網域。
 */
export function resolveReputationDomain(
  senderAddress: string,
  parsed: ParsedAuthResults,
): string | null {
  return resolveAuthDomain(senderAddress, parsed) ?? senderDomain(senderAddress);
}

export type ReputationVerdict = "clean" | "threat" | "unknown" | "error";

export interface DomainReputation {
  domain: string;
  verdict: ReputationVerdict;
  threatTypes: string[];
  checkedAt: string | null;
  errorMessage?: string | null;
}

export interface TrustEvidence {
  signal: "gmail_auth" | "safe_browsing" | "local_allowlist";
  /** 證據來源名稱，顯示為連結文字。 */
  label: string;
  /** 中文一句話結論。 */
  detail: string;
  href: string | null;
  external: boolean;
  /** 原始資料（如標頭原文），供展開檢視。 */
  raw?: string;
}

export interface TrustAssessment {
  level: TrustLevel;
  levelLabel: string;
  reason: string;
  spf: AuthResult;
  dkim: AuthResult;
  dmarc: AuthResult;
  authDomain: string | null;
  evidence: TrustEvidence[];
}

export interface TrustAssessmentInput {
  senderAddress: string;
  /** 用於產生 /emails/<id> 證據連結 */
  emailId: string;
  authenticationResults: string | null;
  receivedSpf?: string | null;
  /** 未查詢或查不到時傳 null */
  reputation?: DomainReputation | null;
}

function safeBrowsingHref(domain: string): string {
  return `https://transparencyreport.google.com/safe-browsing/search?url=${encodeURIComponent(domain)}`;
}

function buildAuthDetail(parsed: ParsedAuthResults, authDomain: string | null): string {
  if (!parsed.raw) {
    return "此郵件未附帶驗證標頭，無法確認寄件網域是否遭偽造。";
  }
  const parts = [
    `SPF ${AUTH_RESULT_LABELS[parsed.spf]}`,
    `DKIM ${AUTH_RESULT_LABELS[parsed.dkim]}`,
    `DMARC ${AUTH_RESULT_LABELS[parsed.dmarc]}`,
  ];
  const suffix = authDomain ? `（對齊網域 ${authDomain}）` : "（無通過驗證的對齊網域）";
  return `${parts.join("、")}${suffix}`;
}

function buildReputationDetail(reputation: DomainReputation): string {
  const checkedAt = reputation.checkedAt ? reputation.checkedAt.slice(0, 10) : "時間不明";
  switch (reputation.verdict) {
    case "threat":
      return `命中威脅類型：${reputation.threatTypes.join("、") || "未分類"}（${checkedAt} 查詢）`;
    case "clean":
      return `未列於惡意網域名單（${checkedAt} 查詢）`;
    default:
      return `查詢未完成（${reputation.errorMessage ?? "原因不明"}），本次判定未採計此訊號`;
  }
}

/** 綜合三個訊號判定寄件者可信度。 */
export function assessSenderTrust(input: TrustAssessmentInput): TrustAssessment {
  const parsed = parseAuthenticationResults(input.authenticationResults);
  const spf = parsed.spf === "none" ? parseReceivedSpf(input.receivedSpf) : parsed.spf;
  const signals: ParsedAuthResults = { ...parsed, spf };

  const authDomain = resolveAuthDomain(input.senderAddress, signals);
  const reputation = input.reputation ?? null;
  const evidence: TrustEvidence[] = [];

  // 證據一：Gmail 驗證標頭（一律存在，缺標頭時說明為何無法驗證）
  evidence.push({
    signal: "gmail_auth",
    label: "Gmail 驗證標頭（Authentication-Results）",
    detail: buildAuthDetail(signals, authDomain),
    href: `/emails/${input.emailId}`,
    external: false,
    ...(signals.raw ? { raw: signals.raw } : {}),
  });

  // 證據二：外部信譽（有查詢過才列出）
  if (reputation) {
    evidence.push({
      signal: "safe_browsing",
      label: "Google Safe Browsing",
      detail: buildReputationDetail(reputation),
      href: safeBrowsingHref(reputation.domain),
      external: true,
    });
  }

  let level: TrustLevel;
  let reason: string;

  if (reputation?.verdict === "threat") {
    // 外部訊號可單獨定罪，不可單獨赦免
    level = "dangerous";
    reason = `寄件網域 ${reputation.domain} 已被 Google Safe Browsing 列為惡意網域。`;
  } else if (signals.dmarc === "fail" || (signals.spf === "fail" && signals.dkim === "fail")) {
    level = "suspicious";
    reason = "寄件網域驗證失敗，此信件可能偽造寄件者身分。";
  } else {
    if (signals.dmarc === "pass" && (signals.spf === "pass" || signals.dkim === "pass")) {
      level = "trusted";
      reason = "DMARC 與 SPF/DKIM 皆通過，寄件網域已完成驗證。";
    } else if (signals.spf === "pass" || signals.dkim === "pass") {
      level = "likely";
      reason = "SPF 或 DKIM 通過，但未取得完整的 DMARC 對齊驗證。";
    } else {
      level = "unverified";
      reason = "此郵件缺少可用的驗證結果，無法確認寄件者身分。";
    }

    // 白名單只能升一級，且僅作用於已通過驗證的對齊網域
    const trusted = matchTrustedDomain(authDomain);
    if (trusted) {
      const upgraded = UPGRADE_LADDER[level];
      evidence.push({
        signal: "local_allowlist",
        label: `知名網域白名單（${trusted.label}）`,
        detail: upgraded
          ? `寄件網域 ${authDomain} 屬已知機構，安全等級提升一級。`
          : `寄件網域 ${authDomain} 屬已知機構，已為最高等級無須提升。`,
        href: trusted.reference,
        external: true,
      });
      if (upgraded) {
        level = upgraded;
        reason = `${reason}寄件網域屬已知機構白名單，等級提升一級。`;
      }
    }
  }

  return {
    level,
    levelLabel: TRUST_LEVEL_LABELS[level],
    reason,
    spf: signals.spf,
    dkim: signals.dkim,
    dmarc: signals.dmarc,
    authDomain,
    evidence,
  };
}

export interface TrustAssessmentRow {
  trust_level: TrustLevel;
  spf_result: AuthResult;
  dkim_result: AuthResult;
  dmarc_result: AuthResult;
  auth_domain: string | null;
  trust_evidence: TrustEvidence[];
  trust_evaluated_at: string;
  updated_at: string;
}

/** 轉成 first_sender_events 的 update payload。 */
export function assessmentToRow(
  assessment: TrustAssessment,
  now: Date = new Date(),
): TrustAssessmentRow {
  const timestamp = now.toISOString();
  return {
    trust_level: assessment.level,
    spf_result: assessment.spf,
    dkim_result: assessment.dkim,
    dmarc_result: assessment.dmarc,
    auth_domain: assessment.authDomain,
    trust_evidence: assessment.evidence,
    trust_evaluated_at: timestamp,
    updated_at: timestamp,
  };
}
