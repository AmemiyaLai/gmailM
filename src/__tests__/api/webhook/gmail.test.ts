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
  mockListHistory, mockGetMessage, mockGetMessageState, mockGetInboxUnreadCount,
  mockStartWatch, mockIsHistoryIdExpired, mockReconcileUnreadInbox, mockClassifyEmail,
  mockClassifyGmailApiError,
  mockSendDiscordNotification, mockJudgeEmailImportance,
  mockNormalizeSenderAddress, mockRegisterFirstSender,
  mockRefreshSenderTags, mockGetSupabase,
} = vi.hoisted(() => ({
  mockListHistory: vi.fn(),
  mockGetMessage: vi.fn(),
  mockGetMessageState: vi.fn().mockResolvedValue({
    id: "msg-dup", threadId: "t-1", labels: ["INBOX", "UNREAD"], isRead: false,
  }),
  mockGetInboxUnreadCount: vi.fn().mockResolvedValue(5),
  mockStartWatch: vi.fn().mockResolvedValue({ historyId: "500", expiration: "999" }),
  mockIsHistoryIdExpired: vi.fn().mockReturnValue(false),
  mockClassifyGmailApiError: vi.fn((error: unknown) => ({
    status: (error as { code?: number })?.code ?? null,
    rateLimited: (error as { code?: number })?.code === 429,
    historyExpired: (error as { code?: number })?.code === 404,
    retryAfter: null,
    message: error instanceof Error ? error.message : String(error),
  })),
  mockReconcileUnreadInbox: vi.fn().mockResolvedValue({
    gmailThreadsUnread: 5, reconciled: 0, remaining: 0, failed: 0, completed: true,
  }),
  mockClassifyEmail: vi.fn().mockReturnValue("devlog"),
  mockSendDiscordNotification: vi.fn().mockResolvedValue(undefined),
  mockJudgeEmailImportance: vi.fn().mockResolvedValue({ important: true, reason: "test" }),
  mockNormalizeSenderAddress: vi.fn().mockReturnValue("test@example.com"),
  mockRegisterFirstSender: vi.fn().mockResolvedValue(null),
  mockRefreshSenderTags: vi.fn().mockResolvedValue(undefined),
  mockGetSupabase: vi.fn(),
}));

const { mockEvaluateAndStoreTrust } = vi.hoisted(() => ({
  mockEvaluateAndStoreTrust: vi.fn().mockResolvedValue({ level: "unverified" }),
}));

const { mockAcquireGmailSyncLease } = vi.hoisted(() => ({
  mockAcquireGmailSyncLease: vi.fn().mockResolvedValue({
    status: "acquired", token: "lease-token", lastHistoryId: null, retryAfter: null,
  }),
}));

vi.mock("../../../lib/gmailSyncControl", async (importOriginal) => ({
  ...(await importOriginal()),
  acquireGmailSyncLease: mockAcquireGmailSyncLease,
}));

vi.mock("../../../lib/senderTrustService", () => ({
  evaluateAndStoreTrust: mockEvaluateAndStoreTrust,
}));

vi.mock("../../../lib/gmail", () => ({
  listHistory: mockListHistory,
  getMessage: mockGetMessage,
  getMessageState: mockGetMessageState,
  getInboxUnreadCount: mockGetInboxUnreadCount,
  startWatch: mockStartWatch,
  isHistoryIdExpired: mockIsHistoryIdExpired,
  classifyGmailApiError: mockClassifyGmailApiError,
}));

vi.mock("../../../lib/emailSync", () => ({
  reconcileUnreadInbox: mockReconcileUnreadInbox,
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

function setupSupabase(opts?: { lastHistoryId?: number | null; cooldownUntil?: string | null; existingEmailIds?: string[] }) {
  const selectResult = {
    data: opts?.lastHistoryId !== undefined || opts?.cooldownUntil !== undefined
      ? { last_history_id: opts?.lastHistoryId ?? null, cooldown_until: opts?.cooldownUntil ?? null }
      : null,
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
      delete: vi.fn().mockReturnThis(),
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
    vi.stubEnv("GMAIL_AUTOMATION_ENABLED", "true");
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: PUSH_SERVICE_ACCOUNT,
        email_verified: true,
        azp: "123",
      }),
    });
    mockEvaluateAndStoreTrust.mockResolvedValue({ level: "unverified" });
  });

  it("自動化開關關閉時應直接 ACK，不驗證或呼叫 Gmail", async () => {
    vi.stubEnv("GMAIL_AUTOMATION_ENABLED", "false");
    const res = await POST(makeContext(undefined, { emailAddress: "test@gmail.com", historyId: "200" }));
    expect(res.status).toBe(204);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
    expect(mockListHistory).not.toHaveBeenCalled();
  });

  it("upsert payload 應包含驗證標頭欄位", async () => {
    const { chain } = setupSupabase({ lastHistoryId: 50 });
    mockListHistory.mockResolvedValue({ messages: [{ messageId: "msg-1" }] });
    mockGetMessage.mockResolvedValue({
      id: "msg-1",
      threadId: "t-1",
      sender: "Test <test@example.com>",
      recipient: "me@gmail.com",
      subject: "Test",
      snippet: "s",
      bodyHtml: "",
      bodyPlain: "",
      labels: ["INBOX"],
      receivedAt: new Date("2026-01-01T10:00:00Z"),
      isRead: false,
      authenticationResults: "mx.google.com; dmarc=pass",
      receivedSpf: "",
    });

    await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));

    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        authentication_results: "mx.google.com; dmarc=pass",
        received_spf: null,
      }),
      { onConflict: "id" },
    );
  });

  it("首次寄件者應以郵件本身的驗證標頭評估安全狀態", async () => {
    setupSupabase({ lastHistoryId: 50 });
    mockRegisterFirstSender.mockResolvedValue({
      sender_address: "test@example.com",
      notification_attempts: 0,
    });
    mockListHistory.mockResolvedValue({ messages: [{ messageId: "msg-1" }] });
    mockGetMessage.mockResolvedValue({
      id: "msg-1",
      threadId: "t-1",
      sender: "Test <test@example.com>",
      recipient: "me@gmail.com",
      subject: "Test",
      snippet: "s",
      bodyHtml: "",
      bodyPlain: "",
      labels: ["INBOX"],
      receivedAt: new Date("2026-01-01T10:00:00Z"),
      isRead: false,
      authenticationResults: "mx.google.com; dmarc=pass",
      receivedSpf: "pass",
    });

    const res = await POST(
      makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }),
    );

    expect(res.status).toBe(200);
    expect(mockEvaluateAndStoreTrust).toHaveBeenCalledWith(expect.anything(), {
      senderAddress: "test@example.com",
      emailId: "msg-1",
      authenticationResults: "mx.google.com; dmarc=pass",
      receivedSpf: "pass",
    });
  });

  it("安全狀態評估失敗不應影響回應與後續處理", async () => {
    setupSupabase({ lastHistoryId: 50 });
    mockEvaluateAndStoreTrust.mockRejectedValue(new Error("boom"));
    mockRegisterFirstSender.mockResolvedValue({
      sender_address: "test@example.com",
      notification_attempts: 0,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockListHistory.mockResolvedValue({ messages: [{ messageId: "msg-1" }] });
    mockGetMessage.mockResolvedValue({
      id: "msg-1",
      threadId: "t-1",
      sender: "Test <test@example.com>",
      recipient: "me@gmail.com",
      subject: "Test",
      snippet: "s",
      bodyHtml: "",
      bodyPlain: "",
      labels: ["INBOX"],
      receivedAt: new Date("2026-01-01T10:00:00Z"),
      isRead: false,
      authenticationResults: "",
      receivedSpf: "",
    });

    const res = await POST(
      makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }),
    );

    expect(res.status).toBe(200);
    // 評估失敗只記錄錯誤，不得中斷處理或阻止 history cursor 前推
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
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

  it("首次 baseline 記錄時應回傳 204", async () => {
    setupSupabase({ lastHistoryId: null });
    const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "100" }));
    expect(res.status).toBe(204);
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
    expect(chain.update).not.toHaveBeenCalledWith(expect.objectContaining({ last_history_id: expect.anything() }));
    consoleSpy.mockRestore();
  });

  it("listHistory 遇到 429 時應記錄冷卻並回 204", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { chain } = setupSupabase({ lastHistoryId: 50 });
    mockListHistory.mockRejectedValue(Object.assign(new Error("rate limited"), { code: 429 }));

    const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));

    expect(res.status).toBe(204);
    expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({
      watch_address: "test@gmail.com",
      cooldown_until: expect.any(String),
    }));
    expect(chain.update).not.toHaveBeenCalledWith(expect.objectContaining({ last_history_id: expect.anything() }));
    warnSpy.mockRestore();
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

  it("既有郵件標籤變更時應更新 labels 與 is_read，不重複通知", async () => {
    const { chain } = setupSupabase({ lastHistoryId: 50, existingEmailIds: ["msg-state"] });
    mockListHistory.mockResolvedValue({
      historyId: "300",
      messages: [{ messageId: "msg-state", kind: "stateChanged", labelIds: ["UNREAD"] }],
    });
    mockGetMessageState.mockResolvedValueOnce({
      id: "msg-state", threadId: "t-1", labels: ["INBOX"], isRead: true,
    });

    const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "300" }));

    expect(res.status).toBe(200);
    expect(chain.update).toHaveBeenCalledWith({ labels: ["INBOX"], is_read: true });
    expect(mockGetMessage).not.toHaveBeenCalled();
    expect(mockSendDiscordNotification).not.toHaveBeenCalled();
  });

  it("永久刪除事件應移除資料庫郵件", async () => {
    const { chain } = setupSupabase({ lastHistoryId: 50 });
    mockListHistory.mockResolvedValue({
      historyId: "300",
      messages: [{ messageId: "msg-deleted", kind: "deleted", labelIds: [] }],
    });

    const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "300" }));

    expect(res.status).toBe(200);
    expect(chain.delete).toHaveBeenCalled();
    expect(mockGetMessage).not.toHaveBeenCalled();
  });

  it("historyId 過期時應建立恢復基準並執行分批全量對帳", async () => {
    setupSupabase({ lastHistoryId: 50 });
    mockListHistory.mockRejectedValueOnce({ response: { status: 404 } });
    mockIsHistoryIdExpired.mockReturnValueOnce(true);

    const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "300" }));

    expect(res.status).toBe(200);
    expect(mockStartWatch).toHaveBeenCalled();
    expect(mockReconcileUnreadInbox).toHaveBeenCalledWith(20, "500");
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
    // 事件維持 pending，改由 first-sender-digest 排程彙整發送，webhook 不再即時通知
    expect(mockEvaluateAndStoreTrust).toHaveBeenCalled();
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
    const { chain } = setupSupabase({ lastHistoryId: 50 });
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
    expect(consoleSpy).toHaveBeenCalledWith("gmail_message_process_failed", expect.objectContaining({
      messageId: "msg-fail",
      message: "getMessage fail",
    }));
    // 其餘郵件仍要處理完，但游標不前推，讓 Pub/Sub 重送時補上失敗那封
    expect(mockGetMessage).toHaveBeenCalledWith("msg-ok");
    
    // 允許 finally 釋放 lease，但不可前推 history 游標。
    expect(chain.update).not.toHaveBeenCalledWith(expect.objectContaining({ last_history_id: expect.anything() }));
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

    it("包裝格式的首次 baseline 記錄應回 204", async () => {
      setupSupabase({ lastHistoryId: null });

      const res = await POST(
        makeContext("Bearer valid", envelope({ emailAddress: "test@gmail.com", historyId: "100" })),
      );

      expect(res.status).toBe(204);
    });

    it("message.data 內缺少必要欄位時應回 400", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(makeContext("Bearer valid", envelope({ emailAddress: "a" })));

      expect(res.status).toBe(400);
      consoleSpy.mockRestore();
    });
  });

  describe("租約與游標處理", () => {
    beforeEach(() => {
      mockAcquireGmailSyncLease.mockResolvedValue({
        status: "acquired", token: "lease-token", lastHistoryId: null, retryAfter: null,
      });
    });

    it("lease 非 acquired 時應回 204 並帶 Retry-After", async () => {
      setupSupabase({ lastHistoryId: 50 });
      mockAcquireGmailSyncLease.mockResolvedValueOnce({
        status: "cooldown", token: null, lastHistoryId: null, retryAfter: "2026-08-01T00:00:00Z",
      });

      const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));

      expect(res.status).toBe(204);
      expect(res.headers.get("Retry-After")).toBe("2026-08-01T00:00:00Z");
      expect(mockListHistory).not.toHaveBeenCalled();
    });

    it("acquire lease 失敗時應回 500", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      setupSupabase({ lastHistoryId: 50 });
      mockAcquireGmailSyncLease.mockRejectedValueOnce(new Error("lease rpc down"));

      const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));

      expect(res.status).toBe(500);
      expect(consoleSpy).toHaveBeenCalledWith("gmail_sync_lease_acquire_failed", expect.objectContaining({
        message: "lease rpc down",
      }));
      consoleSpy.mockRestore();
    });

    it("historyId 未超前時應直接 ACK 204", async () => {
      setupSupabase({ lastHistoryId: 200 });

      const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));

      expect(res.status).toBe(204);
      expect(mockListHistory).not.toHaveBeenCalled();
    });

    it("cooldown 未過期時應直接 ACK 204", async () => {
      setupSupabase({
        lastHistoryId: 50,
        cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
      });

      const res = await POST(makeContext("Bearer valid", { emailAddress: "test@gmail.com", historyId: "200" }));

      expect(res.status).toBe(204);
      expect(mockListHistory).not.toHaveBeenCalled();
    });
  });

  describe("OIDC token 額外驗證分支", () => {
    it("PUBSUB_PUSH_SERVICE_ACCOUNT 未設定時應回 401", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubEnv("PUBSUB_PUSH_SERVICE_ACCOUNT", "");

      const res = await POST(makeContext("Bearer valid", envelope({ emailAddress: "a", historyId: "1" })));

      expect(res.status).toBe(401);
      consoleSpy.mockRestore();
    });

    it("verifyIdToken 回傳 null payload 時應回 401", async () => {
      mockVerifyIdToken.mockResolvedValueOnce({ getPayload: () => null });

      const res = await POST(makeContext("Bearer valid", envelope({ emailAddress: "a", historyId: "1" })));

      expect(res.status).toBe(401);
    });
  });
});
