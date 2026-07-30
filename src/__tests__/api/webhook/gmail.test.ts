import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("CRON_SECRET", "test-secret");
vi.stubEnv("PUBSUB_AUDIENCE", "test-audience");
vi.stubEnv("GCP_PROJECT_ID", "myproject");
vi.stubEnv("PUBSUB_PUSH_SERVICE_ACCOUNT", "gmail-push@myproject.iam.gserviceaccount.com");

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

const PUSH_SERVICE_ACCOUNT = "gmail-push@myproject.iam.gserviceaccount.com";

/** 把 payload 包成 GCP Pub/Sub 標準 push envelope */
function envelope(payload: object) {
  return {
    message: {
      data: Buffer.from(JSON.stringify(payload)).toString("base64"),
      messageId: "m1",
      publishTime: "2026-01-01T00:00:00Z",
    },
    subscription: "projects/myproject/subscriptions/gmail-push",
  };
}

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

function setupSupabase(opts?: { lastHistoryId?: number | null; existingEmailIds?: string[] }) {
  const selectResult = {
    data: opts?.lastHistoryId !== undefined ? { last_history_id: opts.lastHistoryId } : null,
    error: null,
  };
  const existing = new Set(opts?.existingEmailIds ?? []);

  function makeChain() {
    // 冪等守門用 .eq("id", messageId).maybeSingle() 查郵件是否已存在，
    // 記下最後一次 eq 的值才能判斷該回什麼。
    let lastEqValue: unknown;
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((_col: string, value: unknown) => {
        lastEqValue = value;
        return chain;
      }),
      single: vi.fn(async () => {
        // 當 `maybeSingle` 用於 `id` 查詢時，會透過 eq 先將 id 暫存到 lastEqValue，但為了相容
        // 舊測試可能直接呼叫 single() 獲取 last_history_id，當有設定時優先回傳，否則回空。
        if (selectResult.data && selectResult.data.last_history_id !== undefined) {
          return selectResult;
        }
        return { data: null, error: null };
      }),
      maybeSingle: vi.fn(async () => {
        if (existing.has(String(lastEqValue))) {
          // 返回 is_important 與 category 為 undefined，代表這封信需要被豐富化 (已經存在但未豐富化)
          // 若要完全跳過 (代表已存在且已豐富化)，可返回 { id: lastEqValue, category: "devlog" }
          return { data: { id: lastEqValue, category: "devlog" }, error: null };
        }
        return { data: null, error: null };
      }),
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

  mockGetSupabase.mockReturnValue({
    from: fromMock,
  } as never);

  return { chain: supabaseChain, fromMock };
}

describe("POST /api/webhook/gmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: PUSH_SERVICE_ACCOUNT,
        email_verified: true,
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

  it("listHistory 失敗時應回 500 且不前推 last_history_id", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { chain } = setupSupabase({ lastHistoryId: 50 });
    mockListHistory.mockRejectedValue(new Error("history fail"));

    const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));

    // 前推游標會讓這區間的郵件永久遺失，必須讓 Pub/Sub 重送
    expect(res.status).toBe(500);
    expect(chain.update).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("應以 listHistory 回傳的 historyId 作為新游標", async () => {
    const { chain } = setupSupabase({ lastHistoryId: 50 });
    mockListHistory.mockResolvedValue({ historyId: "321", messages: [] });

    const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));

    expect(res.status).toBe(200);
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ last_history_id: 321 }),
    );
  });

  it("郵件已存在於 DB 時應跳過，不重複處理與通知", async () => {
    setupSupabase({ lastHistoryId: 50, existingEmailIds: ["msg-dup"] });
    mockListHistory.mockResolvedValue({ historyId: "300", messages: [{ messageId: "msg-dup" }] });

    const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "300" }));

    expect(res.status).toBe(200);
    expect(mockGetMessage).not.toHaveBeenCalled();
    expect(mockSendDiscordNotification).not.toHaveBeenCalled();
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

  it("當郵件不重要時不應發送 Discord 通知", async () => {
    setupSupabase({ lastHistoryId: 50 });
    mockListHistory.mockResolvedValue({ messages: [{ messageId: "msg-unimportant" }] });
    mockGetMessage.mockResolvedValue({
      id: "msg-unimportant",
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
    mockJudgeEmailImportance.mockResolvedValueOnce({ important: false, reason: "廣告" });

    await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));
    expect(mockSendDiscordNotification).not.toHaveBeenCalled();
  });

  it("單封郵件處理失敗時應處理完其餘郵件，但回 500 且不前推游標", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { chain, fromMock } = setupSupabase({ lastHistoryId: 50 });
    mockListHistory.mockResolvedValue({
      messages: [{ messageId: "msg-fail" }, { messageId: "msg-ok" }],
    });
    mockGetMessage
      .mockRejectedValueOnce(new Error("getMessage fail"))
      .mockResolvedValueOnce({
        id: "msg-ok",
        threadId: "t-ok",
        sender: "Ok <ok@example.com>",
        recipient: "me@gmail.com",
        subject: "OK",
        snippet: "fine",
        bodyHtml: "",
        bodyPlain: "",
        labels: ["INBOX"],
        receivedAt: new Date(),
        isRead: false,
      });

    const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));
    expect(res.status).toBe(500);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to process message msg-fail"), expect.any(Error));
    // 其餘郵件仍要處理完，但游標不前推，讓 Pub/Sub 重送時補上失敗那封
    expect(mockGetMessage).toHaveBeenCalledWith("msg-ok");
    
    // 檢查是否有前推 gmail_sync_state (應為不前推，即沒有呼叫 eq("watch_address", "test@gmail.com") 去 update)
    // 雖然中間處理其他信件時有呼叫 .update() 去更新 emails 欄位，但 gmail_sync_state 的 update 應未被執行。
    // 我們可以藉由檢查 supabase.from 傳入的 table 來驗證，但由於 mock 是共用的，
    // 我們可以直接斷言最後沒有完成的更新，或者追蹤 from('gmail_sync_state') 的呼叫次數。
    const syncStateUpdateCalls = fromMock.mock.calls.filter(
      (c) => (c as unknown as [string, ...unknown[]])[0] === "gmail_sync_state",
    );
    // 第一次是 select 一次，之後失敗不應有第二次（也就是不進行 update）
    expect(syncStateUpdateCalls.length).toBe(1);
    consoleSpy.mockRestore();
  });

  it("當 Discord 通知拋出異常時應 capture 錯誤不中斷處理", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setupSupabase({ lastHistoryId: 50 });
    mockListHistory.mockResolvedValue({ messages: [{ messageId: "msg-discord-err" }] });
    mockGetMessage.mockResolvedValue({
      id: "msg-discord-err",
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
    mockJudgeEmailImportance.mockResolvedValueOnce({ important: true, reason: "緊急" });
    mockSendDiscordNotification.mockRejectedValueOnce(new Error("discord webhook fail"));

    const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));
    expect(res.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to send Discord notification"), expect.any(Error));
    consoleSpy.mockRestore();
  });

  describe("OIDC token 驗證", () => {
    it("token email 與 PUBSUB_PUSH_SERVICE_ACCOUNT 不符時應回 401", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({ email: "attacker@evil.com", email_verified: true, azp: "123" }),
      });

      const res = await POST(makeContext("Bearer valid", envelope({ emailAddress: "a", historyId: "1" })));

      expect(res.status).toBe(401);
      consoleSpy.mockRestore();
    });

    it("email_verified 不為 true 時應回 401", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({ email: PUSH_SERVICE_ACCOUNT, email_verified: false, azp: "123" }),
      });

      const res = await POST(makeContext("Bearer valid", envelope({ emailAddress: "a", historyId: "1" })));

      expect(res.status).toBe(401);
      consoleSpy.mockRestore();
    });
  });

  describe("Pub/Sub 標準 push envelope", () => {
    it("應解析 base64 包裝的 payload 並正常處理新郵件", async () => {
      const { chain } = setupSupabase({ lastHistoryId: 50 });
      mockListHistory.mockResolvedValue({ historyId: "250", messages: [{ messageId: "msg-1" }] });
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

      const res = await POST(
        makeContext("Bearer valid", envelope({ emailAddress: "test@gmail.com", historyId: "200" })),
      );

      expect(res.status).toBe(200);
      expect(mockListHistory).toHaveBeenCalledWith("50");
      expect(mockGetMessage).toHaveBeenCalledWith("msg-1");
      expect(chain.update).toHaveBeenCalled();
    });

    it("包裝格式的首次 baseline 記錄應回 200", async () => {
      setupSupabase({ lastHistoryId: null });

      const res = await POST(
        makeContext("Bearer valid", envelope({ emailAddress: "test@gmail.com", historyId: "100" })),
      );

      expect(res.status).toBe(200);
      expect(await res.text()).toContain("initial baseline");
    });

    it("message.data 內缺少必要欄位時應回 400", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(makeContext("Bearer valid", envelope({ emailAddress: "a" })));

      expect(res.status).toBe(400);
      consoleSpy.mockRestore();
    });
  });
});
