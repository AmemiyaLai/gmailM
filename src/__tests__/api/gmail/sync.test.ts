import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockReconcileUnreadInbox,
  mockClassifyGmailApiError,
  mockGetSupabase,
  mockAcquireGmailSyncLease,
  mockReleaseGmailSyncLease,
  mockClearGmailFailures,
  mockRecordGmailCooldown,
  mockHandleGmailSyncFailure,
} = vi.hoisted(() => ({
  mockReconcileUnreadInbox: vi.fn().mockResolvedValue({
    gmailThreadsUnread: 3, reconciled: 2, remaining: 0, failed: 0, completed: true,
  }),
  mockClassifyGmailApiError: vi.fn((err: unknown) => ({
    status: (err as { code?: number })?.code ?? null,
    rateLimited: (err as { code?: number })?.code === 429,
    retryAfter: null,
    message: err instanceof Error ? err.message : String(err),
  })),
  mockGetSupabase: vi.fn(),
  mockAcquireGmailSyncLease: vi.fn().mockResolvedValue({
    status: "acquired", token: "lease-token", lastHistoryId: null, retryAfter: null,
  }),
  mockReleaseGmailSyncLease: vi.fn().mockResolvedValue(undefined),
  mockClearGmailFailures: vi.fn().mockResolvedValue(undefined),
  mockRecordGmailCooldown: vi.fn().mockResolvedValue(undefined),
  mockHandleGmailSyncFailure: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/emailSync", () => ({
  reconcileUnreadInbox: mockReconcileUnreadInbox,
}));

vi.mock("../../../lib/gmail", () => ({
  classifyGmailApiError: mockClassifyGmailApiError,
}));

vi.mock("../../../lib/supabase", () => ({
  getSupabase: mockGetSupabase,
}));

vi.mock("../../../lib/gmailSyncControl", () => ({
  acquireGmailSyncLease: mockAcquireGmailSyncLease,
  releaseGmailSyncLease: mockReleaseGmailSyncLease,
  clearGmailFailures: mockClearGmailFailures,
  recordGmailCooldown: mockRecordGmailCooldown,
  handleGmailSyncFailure: mockHandleGmailSyncFailure,
}));

import { POST } from "../../../pages/api/gmail/sync";

describe("POST /api/gmail/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GMAIL_AUTOMATION_ENABLED", "true");
  });

  it("自動化暫停時不應建立 lease 或呼叫 Gmail", async () => {
    vi.stubEnv("GMAIL_AUTOMATION_ENABLED", "false");

    const res = await POST({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "paused" });
    expect(mockReconcileUnreadInbox).not.toHaveBeenCalled();
  });

  it("手動同步成功時應回傳對帳結果", async () => {
    const res = await POST({} as never);
    expect(res.status).toBe(200);
    expect(mockReconcileUnreadInbox).toHaveBeenCalledWith(20);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.gmailThreadsUnread).toBe(3);
    expect(body.reconciled).toBe(2);
    expect(body.failed).toBe(0);
  });

  it("同步失敗時應回傳 500", async () => {
    mockReconcileUnreadInbox.mockRejectedValueOnce(new Error("Gmail API error"));
    const res = await POST({} as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Gmail API error");
  });

  it("非 Error 例外應回傳 Unknown error", async () => {
    mockReconcileUnreadInbox.mockRejectedValueOnce("string error");
    const res = await POST({} as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Unknown error");
  });
});

describe("POST /api/gmail/sync（已設定 GMAIL_WATCH_ADDRESS）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GMAIL_AUTOMATION_ENABLED", "true");
    vi.stubEnv("GMAIL_WATCH_ADDRESS", "me@gmail.com");
    mockGetSupabase.mockReturnValue({} as never);
  });

  it("成功時應清除熔斷計數並釋放 lease", async () => {
    const res = await POST({} as never);

    expect(res.status).toBe(200);
    expect(mockAcquireGmailSyncLease).toHaveBeenCalledWith(expect.anything(), "me@gmail.com");
    expect(mockClearGmailFailures).toHaveBeenCalledWith(expect.anything(), "me@gmail.com");
    expect(mockReleaseGmailSyncLease).toHaveBeenCalledWith(expect.anything(), "me@gmail.com", "lease-token");
  });

  it("lease 為 busy 時應回傳狀態且不執行對帳", async () => {
    mockAcquireGmailSyncLease.mockResolvedValueOnce({
      status: "busy", token: null, lastHistoryId: null, retryAfter: null,
    });
    const res = await POST({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "busy" });
    expect(mockReconcileUnreadInbox).not.toHaveBeenCalled();
    expect(mockReleaseGmailSyncLease).not.toHaveBeenCalled();
  });

  it("cooldown 狀態應回傳 retryAfter", async () => {
    mockAcquireGmailSyncLease.mockResolvedValueOnce({
      status: "cooldown", token: null, lastHistoryId: null, retryAfter: "2026-08-01T00:00:00Z",
    });
    const res = await POST({} as never);
    const body = await res.json();

    expect(body.status).toBe("cooldown");
    expect(body.retryAfter).toBe("2026-08-01T00:00:00Z");
  });

  it("Gmail 429 時應記錄冷卻並回傳 cooldown 而非 500", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockReconcileUnreadInbox.mockRejectedValueOnce(Object.assign(new Error("quota exceeded"), { code: 429 }));
    const res = await POST({} as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("cooldown");
    expect(body.retryAfter).toEqual(expect.any(String));
    expect(mockRecordGmailCooldown).toHaveBeenCalledWith(
      expect.anything(),
      "me@gmail.com",
      expect.any(Date),
      "quota exceeded",
    );
    expect(mockHandleGmailSyncFailure).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("同步失敗時應呼叫 handleGmailSyncFailure 並回傳 500", async () => {
    mockReconcileUnreadInbox.mockRejectedValueOnce(new Error("Gmail API error"));
    const res = await POST({} as never);

    expect(res.status).toBe(500);
    expect(mockHandleGmailSyncFailure).toHaveBeenCalledWith(
      expect.anything(),
      "me@gmail.com",
      "Gmail API error",
      "manualSync",
    );
  });

  it("清除熔斷失敗時不應影響成功回應", async () => {
    mockClearGmailFailures.mockRejectedValueOnce(new Error("db down"));
    const res = await POST({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  it("記錄冷卻失敗時仍應回傳 cooldown 回應", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockReconcileUnreadInbox.mockRejectedValueOnce(Object.assign(new Error("quota exceeded"), { code: 429 }));
    mockRecordGmailCooldown.mockRejectedValueOnce(new Error("db down"));
    const res = await POST({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "cooldown" });
    warnSpy.mockRestore();
  });

  it("釋放 lease 失敗時不應影響回應", async () => {
    mockReleaseGmailSyncLease.mockRejectedValueOnce(new Error("db down"));
    const res = await POST({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });
});
