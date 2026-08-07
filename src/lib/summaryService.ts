import { getSupabase } from "./supabase";
import { summarizeUnreadEmails } from "./gemini";
import { sendDiscordSummary } from "./discord";
import { env } from "./env";

interface UnreadEmailRow {
  sender: string;
  subject: string;
  snippet: string;
  category: string | null;
  received_at: string;
}

export interface GeneratedSummary {
  summaryText: string;
  emailCount: number;
  periodStart: Date;
  periodEnd: Date;
}

export type GenerateSummaryResult =
  | { status: "skipped"; reason: string }
  | ({ status: "ok" } & GeneratedSummary);

/** 區分失敗來源，讓 API route 能回傳合適的 HTTP status */
export class SummaryError extends Error {
  constructor(
    message: string,
    readonly code: "db" | "gemini",
    /** 底層錯誤摘要（例如 Gemini 的 API_KEY_INVALID），供 API 回應附帶排查資訊 */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "SummaryError";
  }
}

/** 取出底層錯誤最有辨識度的一行，避免把整包 JSON 塞進回應 */
function describeError(err: unknown): string | undefined {
  if (!(err instanceof Error) || !err.message) return undefined;
  return err.message.slice(0, 300);
}

export interface GenerateUnreadSummaryOptions {
  /** true 時略過「自上次摘要後沒有新未讀郵件」的檢查，供手動重新產生使用 */
  force?: boolean;
}

/**
 * 讀取目前所有未讀郵件、產生 AI 摘要並寫入 email_summaries。
 * 不負責 Discord 發送，由呼叫端決定。
 */
export async function generateUnreadSummary(
  options: GenerateUnreadSummaryOptions = {},
): Promise<GenerateSummaryResult> {
  const supabase = getSupabase();

  const { data, error } = (await supabase
    .from("unread_inbox_threads" as never)
    .select("sender, subject, snippet, category, received_at")
    .order("received_at", { ascending: true })) as {
    data: UnreadEmailRow[] | null;
    error: unknown;
  };

  if (error) {
    console.error("Summary: failed to fetch unread emails:", error);
    throw new SummaryError("Failed to fetch unread emails", "db");
  }

  const unread = data ?? [];
  if (unread.length === 0) {
    return { status: "skipped", reason: "no unread emails" };
  }

  const periodStart = new Date(unread[0].received_at);
  const periodEnd = new Date(unread[unread.length - 1].received_at);

  if (!options.force) {
    const { data: lastSummary } = (await supabase
      .from("email_summaries" as never)
      .select("period_end")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: { period_end: string } | null };

    if (lastSummary && periodEnd.getTime() <= new Date(lastSummary.period_end).getTime()) {
      return { status: "skipped", reason: "no new unread emails since last summary" };
    }
  }

  let summaryText: string;
  try {
    summaryText = await summarizeUnreadEmails(
      unread.map((e) => ({
        sender: e.sender,
        subject: e.subject,
        snippet: e.snippet,
        category: e.category,
        receivedAt: new Date(e.received_at),
      })),
    );
  } catch (err) {
    console.error("Summary: Gemini summarization failed:", err);
    throw new SummaryError("Gemini summarization failed", "gemini", describeError(err));
  }

  const { error: insertError } = await supabase.from("email_summaries" as never).insert({
    summary_text: summaryText,
    email_count: unread.length,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
  } as never);

  if (insertError) {
    console.error("Summary: failed to save summary row:", insertError);
  }

  return { status: "ok", summaryText, emailCount: unread.length, periodStart, periodEnd };
}

interface SummaryRecord {
  id: string;
  summary_text: string;
  email_count: number;
  period_start: string;
  period_end: string;
}

const SUMMARY_COLUMNS = "id, summary_text, email_count, period_start, period_end";

/**
 * 將既有摘要（預設為最新一筆）手動推送至 Discord。
 * 與排程流程不同，這裡的失敗必須讓使用者看到，因此一律拋出例外。
 */
export async function sendSummaryToDiscord(summaryId?: string): Promise<GeneratedSummary> {
  if (!env("DISCORD_WEBHOOK_URL")) {
    throw new SummaryError("DISCORD_WEBHOOK_URL is not configured", "db");
  }

  const supabase = getSupabase();
  const query = supabase.from("email_summaries" as never).select(SUMMARY_COLUMNS);

  const { data, error } = (await (summaryId
    ? query.eq("id", summaryId).maybeSingle()
    : query.order("created_at", { ascending: false }).limit(1).maybeSingle())) as {
    data: SummaryRecord | null;
    error: unknown;
  };

  if (error) {
    console.error("Summary: failed to load summary for Discord:", error);
    throw new SummaryError("Failed to load summary", "db");
  }
  if (!data) {
    throw new SummaryError("Summary not found", "db");
  }

  const payload: GeneratedSummary = {
    summaryText: data.summary_text,
    emailCount: data.email_count,
    periodStart: new Date(data.period_start),
    periodEnd: new Date(data.period_end),
  };

  await sendDiscordSummary({ ...payload, manual: true });
  return payload;
}
