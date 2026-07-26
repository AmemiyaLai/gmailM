import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockTrigger = vi.fn().mockResolvedValue({});
const mockListMessages = vi.fn();
const mockGetMessage = vi.fn();

vi.mock("../lib/supabase", () => ({
  getSupabase: vi.fn(() => ({
    from: vi.fn().mockReturnValue({ upsert: mockUpsert }),
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
}));

import { syncEmailsFromGmail } from "../lib/emailSync";

describe("syncEmailsFromGmail()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue({ error: null });
    mockTrigger.mockResolvedValue({});
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
});
