import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSummarizeUnreadEmails, mockSendDiscordSummary, mockGetSupabase } = vi.hoisted(() => ({
  mockSummarizeUnreadEmails: vi.fn().mockResolvedValue("AI 摘要內容"),
  mockSendDiscordSummary: vi.fn().mockResolvedValue(undefined),
  mockGetSupabase: vi.fn(),
}));

vi.mock("../lib/gemini", () => ({ summarizeUnreadEmails: mockSummarizeUnreadEmails }));
vi.mock("../lib/discord", () => ({ sendDiscordSummary: mockSendDiscordSummary }));
vi.mock("../lib/supabase", () => ({ getSupabase: mockGetSupabase }));

import { generateUnreadSummary, sendSummaryToDiscord, SummaryError } from "../lib/summaryService";

interface UnreadRow {
  sender: string;
  subject: string;
  snippet: string;
  category: string | null;
  received_at: string;
}

const sampleUnread: UnreadRow[] = [
  { sender: "a@test.com", subject: "Hi", snippet: "...", category: "devlog", received_at: "2026-01-01T10:00:00Z" },
];

function setupGenerateChain(opts: {
  unreadEmails?: UnreadRow[];
  unreadError?: unknown;
  lastSummary?: { period_end: string } | null;
  insertError?: unknown;
}) {
  const emailsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: opts.unreadEmails ?? [], error: opts.unreadError ?? null }),
  };
  const summariesChain = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: opts.lastSummary ?? null, error: null }),
  };
  const insertChain = { insert: vi.fn().mockResolvedValue({ error: opts.insertError ?? null }) };

  const fromMock = vi.fn()
    .mockReturnValueOnce(emailsChain)
    .mockReturnValueOnce(summariesChain)
    .mockReturnValueOnce(insertChain);

  mockGetSupabase.mockReturnValue({ from: fromMock } as never);
  return { emailsChain, summariesChain, insertChain, fromMock };
}

describe("generateUnreadSummary()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSummarizeUnreadEmails.mockResolvedValue("AI 摘要內容");
  });

  it("無未讀郵件時應回傳 skipped", async () => {
    setupGenerateChain({ unreadEmails: [] });
    const result = await generateUnreadSummary();
    expect(result).toEqual({ status: "skipped", reason: "no unread emails" });
    expect(mockSummarizeUnreadEmails).not.toHaveBeenCalled();
  });

  it("查詢失敗時應拋出 db 類型的 SummaryError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setupGenerateChain({ unreadError: { message: "db error" } });
    await expect(generateUnreadSummary()).rejects.toMatchObject({ code: "db" });
  });

  it("有未讀郵件時應產生摘要並寫入資料庫", async () => {
    const { insertChain } = setupGenerateChain({ unreadEmails: sampleUnread, lastSummary: null });
    const result = await generateUnreadSummary();
    expect(result).toMatchObject({ status: "ok", emailCount: 1, summaryText: "AI 摘要內容" });
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ summary_text: "AI 摘要內容", email_count: 1 }),
    );
  });

  it("非 force 時，若無新未讀郵件應跳過", async () => {
    setupGenerateChain({
      unreadEmails: sampleUnread,
      lastSummary: { period_end: "2026-12-31T23:59:59Z" },
    });
    const result = await generateUnreadSummary();
    expect(result).toEqual({ status: "skipped", reason: "no new unread emails since last summary" });
  });

  it("force 時應略過上次摘要檢查並直接產生", async () => {
    const emailsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: sampleUnread, error: null }),
    };
    const insertChain = { insert: vi.fn().mockResolvedValue({ error: null }) };
    const fromMock = vi.fn().mockReturnValueOnce(emailsChain).mockReturnValueOnce(insertChain);
    mockGetSupabase.mockReturnValue({ from: fromMock } as never);

    const result = await generateUnreadSummary({ force: true });
    expect(result).toMatchObject({ status: "ok", emailCount: 1 });
    expect(fromMock).toHaveBeenCalledTimes(2); // 沒有查詢上一筆摘要
  });

  it("Gemini 失敗時應拋出 gemini 類型的 SummaryError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setupGenerateChain({ unreadEmails: sampleUnread, lastSummary: null });
    mockSummarizeUnreadEmails.mockRejectedValueOnce(new Error("Gemini error"));
    await expect(generateUnreadSummary()).rejects.toMatchObject({
      code: "gemini",
      detail: "Gemini error",
    });
  });

  it("Gemini 拋出非 Error 時 detail 應為 undefined", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setupGenerateChain({ unreadEmails: sampleUnread, lastSummary: null });
    mockSummarizeUnreadEmails.mockRejectedValueOnce("boom");
    await expect(generateUnreadSummary()).rejects.toMatchObject({
      code: "gemini",
      detail: undefined,
    });
  });

  it("insert 失敗時僅記錄錯誤仍回傳 ok", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setupGenerateChain({ unreadEmails: sampleUnread, lastSummary: null, insertError: { message: "insert failed" } });
    const result = await generateUnreadSummary();
    expect(result.status).toBe("ok");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("failed to save summary row"), expect.any(Object));
    consoleSpy.mockRestore();
  });
});

const summaryRecord = {
  id: "s1",
  summary_text: "摘要內容",
  email_count: 3,
  period_start: "2026-01-01T00:00:00Z",
  period_end: "2026-01-01T12:00:00Z",
};

function setupSendChain(data: typeof summaryRecord | null, error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  mockGetSupabase.mockReturnValue({ from: vi.fn(() => chain) } as never);
  return chain;
}

describe("sendSummaryToDiscord()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("未設定 webhook 時應拋出例外", async () => {
    vi.stubEnv("DISCORD_WEBHOOK_URL", "");
    await expect(sendSummaryToDiscord()).rejects.toBeInstanceOf(SummaryError);
    expect(mockSendDiscordSummary).not.toHaveBeenCalled();
  });

  it("未指定 id 時應發送最新一筆摘要", async () => {
    const chain = setupSendChain(summaryRecord);
    const result = await sendSummaryToDiscord();
    expect(chain.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(chain.eq).not.toHaveBeenCalled();
    expect(result.emailCount).toBe(3);
    expect(mockSendDiscordSummary).toHaveBeenCalledWith(
      expect.objectContaining({ summaryText: "摘要內容", emailCount: 3, manual: true }),
    );
  });

  it("指定 id 時應以該 id 查詢", async () => {
    const chain = setupSendChain(summaryRecord);
    await sendSummaryToDiscord("s1");
    expect(chain.eq).toHaveBeenCalledWith("id", "s1");
    expect(chain.order).not.toHaveBeenCalled();
  });

  it("找不到摘要時應拋出 Summary not found", async () => {
    setupSendChain(null);
    await expect(sendSummaryToDiscord("missing")).rejects.toThrow("Summary not found");
  });

  it("查詢錯誤時應拋出 SummaryError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setupSendChain(null, { message: "db error" });
    await expect(sendSummaryToDiscord()).rejects.toBeInstanceOf(SummaryError);
  });

  it("Discord 發送失敗時應向上拋出", async () => {
    setupSendChain(summaryRecord);
    mockSendDiscordSummary.mockRejectedValueOnce(new Error("Discord webhook failed (500)"));
    await expect(sendSummaryToDiscord()).rejects.toThrow("Discord webhook failed (500)");
  });
});
