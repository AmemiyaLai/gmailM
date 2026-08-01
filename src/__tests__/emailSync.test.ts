import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockFirstSenderInsert = vi.fn();
const mockTrigger = vi.fn().mockResolvedValue({});
const mockListMessages = vi.fn();
const mockGetMessage = vi.fn();
const mockGetMessageState = vi.fn();
const mockListUnreadInboxMessages = vi.fn();
const mockGetInboxUnreadCount = vi.fn();

vi.mock("../lib/supabase", () => ({
  getSupabase: vi.fn(() => ({
    from: vi.fn((table: string) => table === "emails"
      ? { upsert: mockUpsert }
      : { insert: mockFirstSenderInsert }),
  })),
}));

vi.mock("../lib/pusher", () => ({
  getPusher: vi.fn(() => ({
    trigger: mockTrigger,
  })),
}));

vi.mock("../lib/gmail", () => ({
  listMessages: (...args: unknown[]) => mockListMessages(...args),
  getMessage: (...args: unknown[]) => mockGetMessage(...args),
  getMessageState: (...args: unknown[]) => mockGetMessageState(...args),
  listUnreadInboxMessages: (...args: unknown[]) => mockListUnreadInboxMessages(...args),
  getInboxUnreadCount: (...args: unknown[]) => mockGetInboxUnreadCount(...args),
}));

const mockEvaluateAndStoreTrust = vi.fn();
vi.mock("../lib/senderTrustService", () => ({
  evaluateAndStoreTrust: (...args: unknown[]) => mockEvaluateAndStoreTrust(...args),
}));

import { reconcileUnreadInbox, syncEmailsFromGmail } from "../lib/emailSync";

describe("syncEmailsFromGmail()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue({ error: null });
    mockFirstSenderInsert.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } }),
      }),
    });
    mockTrigger.mockResolvedValue({});
    mockEvaluateAndStoreTrust.mockResolvedValue({ level: "unverified" });
  });

  it("upsert payload 應包含驗證標頭欄位", async () => {
    mockListMessages.mockResolvedValue(["msg-1"]);
    mockGetMessage.mockResolvedValue({
      id: "msg-1",
      threadId: "thread-1",
      sender: "a@example.com",
      recipient: "me@example.com",
      subject: "Test",
      snippet: "snip",
      bodyHtml: "",
      bodyPlain: "",
      labels: [],
      receivedAt: new Date("2026-07-26T08:00:00Z"),
      isRead: false,
      authenticationResults: "mx.google.com; spf=pass",
      receivedSpf: "pass",
    });

    await syncEmailsFromGmail(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        authentication_results: "mx.google.com; spf=pass",
        received_spf: "pass",
      }),
      { onConflict: "id" },
    );
  });

  it("缺少驗證標頭時 upsert payload 應寫入 null", async () => {
    mockListMessages.mockResolvedValue(["msg-1"]);
    mockGetMessage.mockResolvedValue({
      id: "msg-1",
      threadId: "thread-1",
      sender: "a@example.com",
      recipient: "me@example.com",
      subject: "Test",
      snippet: "snip",
      bodyHtml: "",
      bodyPlain: "",
      labels: [],
      receivedAt: new Date("2026-07-26T08:00:00Z"),
      isRead: false,
      authenticationResults: "",
      receivedSpf: "",
    });

    await syncEmailsFromGmail(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ authentication_results: null, received_spf: null }),
      { onConflict: "id" },
    );
  });

  it("同步成功時應回傳正確的 imported 數量", async () => {
    mockListMessages.mockResolvedValue(["msg-1", "msg-2"]);
    mockGetMessage.mockResolvedValue({
      id: "msg-1",
      threadId: "thread-1",
      sender: "a@example.com",
      recipient: "me@example.com",
      subject: "Test",
      snippet: "Hello",
      bodyHtml: "<p>Hello</p>",
      bodyPlain: "Hello",
      labels: ["INBOX"],
      receivedAt: new Date("2026-07-26T08:00:00Z"),
      isRead: false,
    });

    const result = await syncEmailsFromGmail(2);
    expect(result.imported).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("should upsert each email to supabase", async () => {
    mockListMessages.mockResolvedValue(["msg-1"]);
    mockGetMessage.mockResolvedValue({
      id: "msg-1",
      threadId: "thread-1",
      sender: "a@example.com",
      recipient: "me@example.com",
      subject: "Test",
      snippet: "snip",
      bodyHtml: "",
      bodyPlain: "",
      labels: [],
      receivedAt: new Date("2026-07-26T08:00:00Z"),
      isRead: false,
    });

    await syncEmailsFromGmail(1);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "msg-1",
        sender: "a@example.com",
      }),
      { onConflict: "id" },
    );
  });

  it("upsert 失敗時應計入 failed", async () => {
    mockListMessages.mockResolvedValue(["msg-1"]);
    mockGetMessage.mockResolvedValue({
      id: "msg-1",
      threadId: "thread-1",
      sender: "a@example.com",
      recipient: "",
      subject: "T",
      snippet: "",
      bodyHtml: "",
      bodyPlain: "",
      labels: [],
      receivedAt: new Date(),
      isRead: false,
    });
    mockUpsert.mockResolvedValue({ error: { message: "db error" } });

    const result = await syncEmailsFromGmail(1);
    expect(result.failed).toBe(1);
    expect(result.imported).toBe(0);
  });

  it("getMessage 拋出異常時應計入 failed", async () => {
    mockListMessages.mockResolvedValue(["msg-1"]);
    mockGetMessage.mockRejectedValue(new Error("network error"));

    const result = await syncEmailsFromGmail(1);
    expect(result.failed).toBe(1);
    expect(result.imported).toBe(0);
  });

  it("部分失敗時應正確計算 imported 和 failed", async () => {
    mockListMessages.mockResolvedValue(["msg-1", "msg-2"]);
    mockGetMessage
      .mockResolvedValueOnce({
        id: "msg-1",
        threadId: "t1",
        sender: "a@b.com",
        recipient: "c@d.com",
        subject: "Ok",
        snippet: "ok",
        bodyHtml: "",
        bodyPlain: "",
        labels: [],
        receivedAt: new Date(),
        isRead: false,
      })
      .mockRejectedValueOnce(new Error("fail"));

    const result = await syncEmailsFromGmail(2);
    expect(result.imported).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("應觸發 pusher 事件通知", async () => {
    mockListMessages.mockResolvedValue([]);
    await syncEmailsFromGmail(0);
    expect(mockTrigger).toHaveBeenCalledWith(
      "gmail-channel",
      "backfill-complete",
      expect.objectContaining({ imported: 0, failed: 0 }),
    );
  });

  it("空訊息列表也應觸發 pusher 事件", async () => {
    mockListMessages.mockResolvedValue([]);
    const result = await syncEmailsFromGmail(0);
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockTrigger).toHaveBeenCalled();
  });

  it("syncEmailsFromGmail 應使用 classifyEmail 分類", async () => {
    mockListMessages.mockResolvedValue(["msg-1"]);
    mockGetMessage.mockResolvedValue({
      id: "msg-1",
      threadId: "t1",
      sender: "noreply@github.com",
      recipient: "me@example.com",
      subject: "PR merged",
      snippet: "merged",
      bodyHtml: "",
      bodyPlain: "",
      labels: [],
      receivedAt: new Date(),
      isRead: false,
    });

    const result = await syncEmailsFromGmail(1);
    expect(result.imported).toBe(1);

    const upsertCall = mockUpsert.mock.calls[0][0];
    expect(upsertCall.category).toBe("devlog");
  });

  it("當產生 firstEvent 時應更新 is_first_sender 欄位，失敗時計入 failed", async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { message: "update failed" } }),
    });
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === "emails") {
        return {
          upsert: mockUpsert,
          update: mockUpdate,
        };
      }
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { sender_address: "new@example.com" }, error: null }),
          }),
        }),
      };
    });

    const { getSupabase } = await import("../lib/supabase");
    vi.mocked(getSupabase).mockReturnValue({ from: mockFrom } as never);

    mockListMessages.mockResolvedValue(["msg-new"]);
    mockGetMessage.mockResolvedValue({
      id: "msg-new",
      threadId: "t1",
      sender: "New Sender <new@example.com>",
      recipient: "me@example.com",
      subject: "Welcome",
      snippet: "hi",
      bodyHtml: "",
      bodyPlain: "",
      labels: [],
      receivedAt: new Date(),
      isRead: false,
    });

    const result = await syncEmailsFromGmail(1);
    expect(result.failed).toBe(1);
    expect(result.imported).toBe(0);
  });

  it("baseline 首次寄件者應以記憶體中的標頭評估安全狀態", async () => {
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === "emails") {
        return {
          upsert: mockUpsert,
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { sender_address: "new@example.com" },
              error: null,
            }),
          }),
        }),
      };
    });

    const { getSupabase } = await import("../lib/supabase");
    vi.mocked(getSupabase).mockReturnValue({ from: mockFrom } as never);

    mockListMessages.mockResolvedValue(["msg-new"]);
    mockGetMessage.mockResolvedValue({
      id: "msg-new",
      threadId: "t1",
      sender: "New Sender <new@example.com>",
      recipient: "me@example.com",
      subject: "Welcome",
      snippet: "hi",
      bodyHtml: "",
      bodyPlain: "",
      labels: [],
      receivedAt: new Date(),
      isRead: false,
      authenticationResults: "mx.google.com; spf=pass",
      receivedSpf: "",
    });

    await syncEmailsFromGmail(1);

    expect(mockEvaluateAndStoreTrust).toHaveBeenCalledWith(
      expect.anything(),
      {
        senderAddress: "new@example.com",
        emailId: "msg-new",
        authenticationResults: "mx.google.com; spf=pass",
        receivedSpf: null,
      },
    );
  });

  it("安全狀態評估失敗不應影響匯入結果", async () => {
    mockEvaluateAndStoreTrust.mockRejectedValue(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === "emails") {
        return {
          upsert: mockUpsert,
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { sender_address: "new@example.com" },
              error: null,
            }),
          }),
        }),
      };
    });

    const { getSupabase } = await import("../lib/supabase");
    vi.mocked(getSupabase).mockReturnValue({ from: mockFrom } as never);

    mockListMessages.mockResolvedValue(["msg-new"]);
    mockGetMessage.mockResolvedValue({
      id: "msg-new",
      threadId: "t1",
      sender: "New Sender <new@example.com>",
      recipient: "me@example.com",
      subject: "Welcome",
      snippet: "hi",
      bodyHtml: "",
      bodyPlain: "",
      labels: [],
      receivedAt: new Date(),
      isRead: false,
      authenticationResults: "",
      receivedSpf: "",
    });

    const result = await syncEmailsFromGmail(1);
    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
    errorSpy.mockRestore();
  });
});

describe("reconcileUnreadInbox()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GMAIL_WATCH_ADDRESS", "me@example.com");
    mockGetInboxUnreadCount.mockResolvedValue(1);
    mockEvaluateAndStoreTrust.mockResolvedValue({ level: "unverified" });
  });

  it("Gmail 有但資料庫缺少的未讀郵件應補匯入", async () => {
    const emailUpsert = vi.fn().mockResolvedValue({ error: null });
    const stateUpsert = vi.fn().mockResolvedValue({ error: null });
    const storedQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      contains: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
      upsert: emailUpsert,
    };
    const firstSenderQuery = {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } }),
        }),
      }),
    };
    const from = vi.fn((table: string) => {
      if (table === "emails") return storedQuery;
      if (table === "gmail_sync_state") return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        upsert: stateUpsert,
      };
      return firstSenderQuery;
    });
    const { getSupabase } = await import("../lib/supabase");
    vi.mocked(getSupabase).mockReturnValue({ from } as never);
    mockListUnreadInboxMessages.mockResolvedValue([{ id: "m1", threadId: "t1" }]);
    mockGetMessage.mockResolvedValue({
      id: "m1", threadId: "t1", sender: "a@example.com", recipient: "me@example.com",
      subject: "Hi", snippet: "", bodyHtml: "", bodyPlain: "",
      labels: ["INBOX", "UNREAD"], receivedAt: new Date("2026-07-31T00:00:00Z"),
      isRead: false, authenticationResults: "", receivedSpf: "",
    });

    const result = await reconcileUnreadInbox(20);

    expect(result).toMatchObject({ reconciled: 1, remaining: 0, failed: 0, completed: true });
    expect(emailUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1", is_read: false, labels: ["INBOX", "UNREAD"] }),
      { onConflict: "id" },
    );
    expect(stateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      inbox_threads_unread: 1,
      reconciliation_status: "idle",
    }));
  });

  it("資料庫殘留未讀郵件應依 Gmail metadata 校正", async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const storedQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      contains: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [{ id: "stale" }], error: null }),
      update,
      delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    };
    const stateUpsert = vi.fn().mockResolvedValue({ error: null });
    const stateQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { recovery_history_id: 777 }, error: null }),
      upsert: stateUpsert,
    };
    const from = vi.fn((table: string) =>
      table === "gmail_sync_state" ? stateQuery : storedQuery);
    const { getSupabase } = await import("../lib/supabase");
    vi.mocked(getSupabase).mockReturnValue({ from } as never);
    mockListUnreadInboxMessages.mockResolvedValue([]);
    mockGetMessageState.mockResolvedValue({
      id: "stale", threadId: "t1", labels: ["INBOX"], isRead: true,
    });

    const result = await reconcileUnreadInbox(20);

    expect(result.completed).toBe(true);
    expect(update).toHaveBeenCalledWith({ labels: ["INBOX"], is_read: true });
    expect(updateEq).toHaveBeenCalledWith("id", "stale");
    expect(stateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      last_history_id: 777,
      recovery_history_id: null,
    }));
  });

  it("批次上限應保留 remaining 供下一次續跑", async () => {
    const storedQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      contains: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    };
    const stateUpsert = vi.fn().mockResolvedValue({ error: null });
    const stateQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      upsert: stateUpsert,
    };
    const from = vi.fn((table: string) =>
      table === "gmail_sync_state" ? stateQuery : storedQuery);
    const { getSupabase } = await import("../lib/supabase");
    vi.mocked(getSupabase).mockReturnValue({ from } as never);
    mockListUnreadInboxMessages.mockResolvedValue([
      { id: "m1", threadId: "t1" },
      { id: "m2", threadId: "t2" },
    ]);
    mockGetMessage.mockRejectedValue(new Error("not needed for second item"));

    const result = await reconcileUnreadInbox(0);

    expect(result).toMatchObject({ reconciled: 0, remaining: 2, completed: false });
    expect(stateUpsert).toHaveBeenCalledWith(expect.objectContaining({ reconciliation_status: "running" }));
  });
});
