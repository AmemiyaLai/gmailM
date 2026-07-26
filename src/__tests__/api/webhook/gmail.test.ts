import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("CRON_SECRET", "test-secret");
vi.stubEnv("PUBSUB_AUDIENCE", "test-audience");
vi.stubEnv("GCP_PROJECT_ID", "myproject");

const { mockVerifyIdToken } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: vi.fn().mockImplementation(function () {
    return { verifyIdToken: mockVerifyIdToken };
  }),
}));

const {
  mockListHistory, mockGetMessage, mockClassifyEmail,
  mockSendDiscordNotification, mockJudgeEmailImportance,
  mockNormalizeSenderAddress, mockRegisterFirstSender,
  mockDeliverFirstSenderNotification, mockRefreshSenderTags, mockGetSupabase,
} = vi.hoisted(() => ({
  mockListHistory: vi.fn(),
  mockGetMessage: vi.fn(),
  mockClassifyEmail: vi.fn().mockReturnValue("devlog"),
  mockSendDiscordNotification: vi.fn().mockResolvedValue(undefined),
  mockJudgeEmailImportance: vi.fn().mockResolvedValue({ important: true, reason: "test" }),
  mockNormalizeSenderAddress: vi.fn().mockReturnValue("test@example.com"),
  mockRegisterFirstSender: vi.fn().mockResolvedValue(null),
  mockDeliverFirstSenderNotification: vi.fn().mockResolvedValue(true),
  mockRefreshSenderTags: vi.fn().mockResolvedValue(undefined),
  mockGetSupabase: vi.fn(),
}));

vi.mock("../../../lib/gmail", () => ({
  listHistory: mockListHistory,
  getMessage: mockGetMessage,
}));

vi.mock("../../../lib/classify", () => ({
  classifyEmail: mockClassifyEmail,
}));

vi.mock("../../../lib/discord", () => ({
  sendDiscordNotification: mockSendDiscordNotification,
}));

vi.mock("../../../lib/gemini", () => ({
  judgeEmailImportance: mockJudgeEmailImportance,
}));

vi.mock("../../../lib/senderAddress", () => ({
  normalizeSenderAddress: mockNormalizeSenderAddress,
}));

vi.mock("../../../lib/firstSender", () => ({
  registerFirstSender: mockRegisterFirstSender,
  deliverFirstSenderNotification: mockDeliverFirstSenderNotification,
}));

vi.mock("../../../lib/senderTagService", () => ({
  refreshSenderTags: mockRefreshSenderTags,
}));

vi.mock("../../../lib/supabase", () => ({
  getSupabase: mockGetSupabase,
}));

vi.mock("../../../lib/pusher", () => ({
  getPusher: vi.fn().mockImplementation(function () {
    return {
      trigger: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

import { POST } from "../../../pages/api/webhook/gmail";

const VALID_TOKEN = "service-123@myproject.iam.gserviceaccount.com";

function makeContext(authHeader?: string, body?: object) {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  headers.set("Content-Type", "application/json");
  const request = new Request("http://localhost/api/webhook/gmail", {
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request } as never;
}

function setupSupabase(opts?: { lastHistoryId?: number | null }) {
  const selectResult = {
    data: opts?.lastHistoryId !== undefined ? { last_history_id: opts.lastHistoryId } : null,
    error: null,
  };

  function makeChain() {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue(selectResult),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ error: null }),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    return chain;
  }

  const supabaseChain = makeChain();
  const fromMock = vi.fn(() => supabaseChain);

  mockGetSupabase.mockReturnValue({ from: fromMock } as never);
  return { chain: supabaseChain };
}

describe("POST /api/webhook/gmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: VALID_TOKEN,
        azp: "123",
      }),
    });
  });

  it("無 Authorization header 應回傳 401", async () => {
    const res = await POST(makeContext(undefined, { emailAddress: "a", historyId: "1" }));
    expect(res.status).toBe(401);
  });

  it("Bearer token 無效時應回傳 401", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error("invalid"));
    const res = await POST(makeContext("Bearer invalid-token", { emailAddress: "a", historyId: "1" }));
    expect(res.status).toBe(401);
  });

  it("無效 JSON body 應回傳 400", async () => {
    const req = new Request("http://localhost/api/webhook/gmail", {
      method: "POST",
      headers: { authorization: "Bearer valid" },
      body: "not json",
    });
    const res = await POST({ request: req } as never);
    expect(res.status).toBe(400);
  });

  it("缺少必要欄位時應回傳 400", async () => {
    const res = await POST(makeContext("Bearer valid", { emailAddress: "a" }));
    expect(res.status).toBe(400);
  });

  it("首次 baseline 記錄時應回傳 200", async () => {
    setupSupabase({ lastHistoryId: null });
    const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "100" }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("initial baseline");
  });

  it("正常處理新郵件時應回傳 200", async () => {
    const { chain } = setupSupabase({ lastHistoryId: 50 });

    mockListHistory.mockResolvedValue({
      messages: [{ messageId: "msg-1" }],
    });

    mockGetMessage.mockResolvedValue({
      id: "msg-1",
      threadId: "t-1",
      sender: "Test <test@example.com>",
      recipient: "me@gmail.com",
      subject: "Test",
      snippet: "Test snippet",
      bodyHtml: "<p>Test</p>",
      bodyPlain: "Test",
      labels: ["INBOX"],
      receivedAt: new Date("2026-01-01T10:00:00Z"),
      isRead: false,
    });

    const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));
    expect(res.status).toBe(200);
    expect(mockGetMessage).toHaveBeenCalledWith("msg-1");
    expect(mockClassifyEmail).toHaveBeenCalled();
    expect(mockJudgeEmailImportance).toHaveBeenCalled();
    expect(mockSendDiscordNotification).toHaveBeenCalled();
    expect(chain.update).toHaveBeenCalled();
  });

  it("Gemini 判斷失敗時應使用 IMPORTANT label fallback", async () => {
    setupSupabase({ lastHistoryId: 50 });

    mockListHistory.mockResolvedValue({ messages: [{ messageId: "msg-1" }] });
    mockGetMessage.mockResolvedValue({
      id: "msg-1",
      threadId: "t-1",
      sender: "Test <test@example.com>",
      recipient: "me@gmail.com",
      subject: "Test",
      snippet: "snippet",
      bodyHtml: "",
      bodyPlain: "",
      labels: ["IMPORTANT"],
      receivedAt: new Date(),
      isRead: false,
    });
    mockJudgeEmailImportance.mockRejectedValueOnce(new Error("gemini fail"));

    const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));
    expect(res.status).toBe(200);
  });

  it("listHistory 拋出異常時應不中斷處理", async () => {
    setupSupabase({ lastHistoryId: 50 });
    mockListHistory.mockRejectedValue(new Error("history fail"));

    const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));
    expect(res.status).toBe(200);
  });

  it("senderAddress 存在時應呼叫 registerFirstSender", async () => {
    setupSupabase({ lastHistoryId: 50 });
    mockListHistory.mockResolvedValue({ messages: [{ messageId: "msg-1" }] });
    mockGetMessage.mockResolvedValue({
      id: "msg-1",
      threadId: "t-1",
      sender: "Test <test@example.com>",
      recipient: "me@gmail.com",
      subject: "Test",
      snippet: "snippet",
      bodyHtml: "",
      bodyPlain: "",
      labels: ["INBOX"],
      receivedAt: new Date(),
      isRead: false,
    });
    mockRegisterFirstSender.mockResolvedValueOnce({ sender_address: "test@example.com" });

    await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));
    expect(mockRegisterFirstSender).toHaveBeenCalled();
    expect(mockDeliverFirstSenderNotification).toHaveBeenCalled();
  });

  it("處理完成後應呼叫 refreshSenderTags", async () => {
    setupSupabase({ lastHistoryId: 50 });
    mockListHistory.mockResolvedValue({ messages: [] });

    await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));
    expect(mockRefreshSenderTags).toHaveBeenCalled();
  });
});
