import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockSyncEmailsFromGmail, mockSummarizeUnreadEmails, mockSendDiscordSummary, mockGetSupabase,
} = vi.hoisted(() => ({
  mockSyncEmailsFromGmail: vi.fn().mockResolvedValue({ imported: 5, failed: 0 }),
  mockSummarizeUnreadEmails: vi.fn().mockResolvedValue("AI 摘要內容"),
  mockSendDiscordSummary: vi.fn().mockResolvedValue(undefined),
  mockGetSupabase: vi.fn(),
}));

vi.mock("../../../lib/emailSync", () => ({
  syncEmailsFromGmail: mockSyncEmailsFromGmail,
}));

vi.mock("../../../lib/gemini", () => ({
  summarizeUnreadEmails: mockSummarizeUnreadEmails,
}));

vi.mock("../../../lib/discord", () => ({
  sendDiscordSummary: mockSendDiscordSummary,
}));

vi.mock("../../../lib/supabase", () => ({
  getSupabase: mockGetSupabase,
}));

import { GET } from "../../../pages/api/gmail/hourly-summary";

function makeContext(authHeader?: string) {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  const request = new Request("http://localhost/api/gmail/hourly-summary", { headers });
  return { request } as never;
}

function setupSupabaseChain(opts: {
  unreadEmails?: Array<{ sender: string; subject: string; snippet: string; category: string | null; received_at: string }>;
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
  const insertChain = {
    insert: vi.fn().mockResolvedValue({ error: opts.insertError ?? null }),
  };

  const fromMock = vi.fn()
    .mockReturnValueOnce(emailsChain)
    .mockReturnValueOnce(summariesChain)
    .mockReturnValueOnce(insertChain);

  mockGetSupabase.mockReturnValue({ from: fromMock } as never);
  return { emailsChain, summariesChain, insertChain };
}

describe("GET /api/gmail/hourly-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T10:00:00+08:00"));
    vi.stubEnv("CRON_SECRET", "test-secret");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("安靜時段（1:00-7:00）應跳過處理", async () => {
    vi.setSystemTime(new Date("2026-07-28T03:00:00+08:00"));
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("skipped");
    expect(body.reason).toBe("quiet hours");
  });

  it("無 Authorization header 應回傳 401", async () => {
    const res = await GET(makeContext());
    expect(res.status).toBe(401);
  });

  it("Authorization 不符時應回傳 401", async () => {
    const res = await GET(makeContext("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("無未讀郵件時應回傳 skipped + no unread emails", async () => {
    setupSupabaseChain({ unreadEmails: [] });
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("skipped");
    expect(body.reason).toBe("no unread emails");
    expect(body.sync).toEqual({ imported: 5, failed: 0 });
  });

  it("sync 失敗不應阻擋摘要流程", async () => {
    mockSyncEmailsFromGmail.mockRejectedValueOnce(new Error("sync fail"));
    setupSupabaseChain({ unreadEmails: [] });
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sync).toEqual({ imported: 0, failed: 0 });
  });

  it("有未讀郵件時應呼叫 summarizeUnreadEmails 並回傳 ok", async () => {
    setupSupabaseChain({
      unreadEmails: [
        { sender: "a@test.com", subject: "Hi", snippet: "...", category: "devlog", received_at: "2026-01-01T10:00:00Z" },
      ],
      lastSummary: null,
    });
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(mockSummarizeUnreadEmails).toHaveBeenCalled();
    expect(mockSendDiscordSummary).toHaveBeenCalled();
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.emailCount).toBe(1);
  });

  it("DB 查詢未讀郵件失敗時應回傳 500", async () => {
    mockSyncEmailsFromGmail.mockResolvedValueOnce({ imported: 0, failed: 0 });
    setupSupabaseChain({ unreadError: { message: "db error" } });
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(500);
  });

  it("summarizeUnreadEmails 失敗時應回傳 502", async () => {
    mockSyncEmailsFromGmail.mockResolvedValueOnce({ imported: 0, failed: 0 });
    setupSupabaseChain({
      unreadEmails: [
        { sender: "a@test.com", subject: "Hi", snippet: "...", category: null, received_at: "2026-01-01T10:00:00Z" },
      ],
      lastSummary: null,
    });
    mockSummarizeUnreadEmails.mockRejectedValueOnce(new Error("Gemini error"));
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(502);
  });

  it("已有相同或更新的 summary 時應跳過", async () => {
    const laterDate = new Date("2026-12-31T23:59:59Z").toISOString();
    setupSupabaseChain({
      unreadEmails: [
        { sender: "a@test.com", subject: "Hi", snippet: "...", category: null, received_at: "2026-01-01T10:00:00Z" },
      ],
      lastSummary: { period_end: laterDate },
    });
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("skipped");
    expect(body.reason).toBe("no new unread emails since last summary");
  });
});
