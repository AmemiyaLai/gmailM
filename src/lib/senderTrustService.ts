import { getMessageAuthHeaders } from "./gmail";
import { getDomainReputations } from "./domainReputation";
import {
  assessSenderTrust,
  assessmentToRow,
  parseAuthenticationResults,
  resolveReputationDomain,
  type DomainReputation,
  type TrustAssessment,
} from "./senderTrust";

/**
 * 寄件者可信度的服務層：串接 Gmail 標頭、外部信譽與純函式判定，並寫回資料庫。
 */

type SupabaseLike = { from: (table: string) => any };

export interface TrustEvaluationInput {
  senderAddress: string;
  emailId: string;
  authenticationResults: string | null;
  receivedSpf: string | null;
}

interface FirstSenderTrustRow {
  sender_address: string;
  first_email_id: string;
}

interface EmailAuthRow {
  id: string;
  authentication_results: string | null;
  received_spf: string | null;
}

export interface TrustBackfillResult {
  /** 本批取出的待評估列 */
  scanned: number;
  /** 實際打 Gmail API 的次數 */
  fetched: number;
  /** 成功寫回的列 */
  assessed: number;
  failed: number;
  /** 仍未評估的總數，供外部迴圈判斷是否續跑 */
  remaining: number;
}

export interface BackfillOptions {
  limit?: number;
  /** 略過 Gmail 呼叫、以既有標頭全量重評（判定規則改版後使用） */
  force?: boolean;
  /** Gmail 逐筆呼叫之間的間隔毫秒數 */
  delayMs?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_DELAY_MS = 120;

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function reputationFor(
  supabase: SupabaseLike,
  domains: string[],
): Promise<Map<string, DomainReputation>> {
  if (domains.length === 0) return new Map();
  try {
    return await getDomainReputations(supabase, domains);
  } catch (error) {
    // 外部信譽只是加分訊號，失敗不得阻斷判定
    console.error("查詢網域信譽失敗，本次略過此訊號", error);
    return new Map();
  }
}

/** 單筆評估並寫回 first_sender_events（即時／baseline 路徑使用）。 */
export async function evaluateAndStoreTrust(
  supabase: SupabaseLike,
  input: TrustEvaluationInput,
): Promise<TrustAssessment> {
  const parsed = parseAuthenticationResults(input.authenticationResults);
  const domain = resolveReputationDomain(input.senderAddress, parsed);
  const reputations = await reputationFor(supabase, domain ? [domain] : []);

  const assessment = assessSenderTrust({
    senderAddress: input.senderAddress,
    emailId: input.emailId,
    authenticationResults: input.authenticationResults,
    receivedSpf: input.receivedSpf,
    reputation: domain ? reputations.get(domain) ?? null : null,
  });

  const { error } = await supabase
    .from("first_sender_events")
    .update(assessmentToRow(assessment) as never)
    .eq("sender_address", input.senderAddress);
  if (error) throw error;

  return assessment;
}

/**
 * 分批回填歷史寄件者的安全狀態。
 *
 * 冪等：任何失敗的列都維持 trust_level = null，下次呼叫會自動重試。
 */
export async function backfillSenderTrust(
  supabase: SupabaseLike,
  opts: BackfillOptions = {},
): Promise<TrustBackfillResult> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;

  let query = supabase.from("first_sender_events").select("sender_address, first_email_id");
  if (!opts.force) query = query.is("trust_level", null);
  const { data: eventData } = await query
    .order("first_received_at", { ascending: false })
    .limit(limit);

  const events = (eventData ?? []) as FirstSenderTrustRow[];
  const result: TrustBackfillResult = {
    scanned: events.length,
    fetched: 0,
    assessed: 0,
    failed: 0,
    remaining: 0,
  };
  if (events.length === 0) {
    result.remaining = await countPending(supabase);
    return result;
  }

  // 一次批讀已落庫的標頭，避免重複呼叫 Gmail
  const { data: emailData } = await supabase
    .from("emails")
    .select("id, authentication_results, received_spf")
    .in("id", events.map((e) => e.first_email_id));
  const headers = new Map(
    ((emailData ?? []) as EmailAuthRow[]).map((row) => [row.id, row]),
  );

  const pending: Array<{ event: FirstSenderTrustRow; row: EmailAuthRow }> = [];

  for (const event of events) {
    const existing = headers.get(event.first_email_id);
    if (existing?.authentication_results) {
      pending.push({ event, row: existing });
      continue;
    }

    if (opts.force) {
      // force 模式完全不打 Gmail，直接以既有（可能為空的）標頭重評
      pending.push({
        event,
        row: existing ?? { id: event.first_email_id, authentication_results: null, received_spf: null },
      });
      continue;
    }

    try {
      if (result.fetched > 0) await sleep(delayMs);
      const fetched = await getMessageAuthHeaders(event.first_email_id);
      result.fetched += 1;

      const row: EmailAuthRow = {
        id: event.first_email_id,
        authentication_results: fetched.authenticationResults || null,
        received_spf: fetched.receivedSpf || null,
      };
      await supabase
        .from("emails")
        .update({
          authentication_results: row.authentication_results,
          received_spf: row.received_spf,
        } as never)
        .eq("id", event.first_email_id);

      pending.push({ event, row });
    } catch (error) {
      // 該列維持 trust_level = null，下次呼叫自動重試
      console.error(`取得郵件 ${event.first_email_id} 的驗證標頭失敗`, error);
      result.failed += 1;
    }
  }

  // 一次查完所有網域的信譽（單次 API 請求可涵蓋 100 個網域）
  const domains = new Set<string>();
  const domainByEvent = new Map<string, string | null>();
  for (const { event, row } of pending) {
    const parsed = parseAuthenticationResults(row.authentication_results);
    const domain = resolveReputationDomain(event.sender_address, parsed);
    domainByEvent.set(event.sender_address, domain);
    if (domain) domains.add(domain);
  }
  const reputations = await reputationFor(supabase, [...domains]);

  for (const { event, row } of pending) {
    const domain = domainByEvent.get(event.sender_address) ?? null;
    const assessment = assessSenderTrust({
      senderAddress: event.sender_address,
      emailId: event.first_email_id,
      authenticationResults: row.authentication_results,
      receivedSpf: row.received_spf,
      reputation: domain ? reputations.get(domain) ?? null : null,
    });

    const { error } = await supabase
      .from("first_sender_events")
      .update(assessmentToRow(assessment) as never)
      .eq("sender_address", event.sender_address);

    if (error) {
      console.error(`寫入 ${event.sender_address} 的安全狀態失敗`, error);
      result.failed += 1;
    } else {
      result.assessed += 1;
    }
  }

  result.remaining = await countPending(supabase);
  return result;
}

async function countPending(supabase: SupabaseLike): Promise<number> {
  const { count } = await supabase
    .from("first_sender_events")
    .select("sender_address", { count: "exact", head: true })
    .is("trust_level", null);
  return count ?? 0;
}
