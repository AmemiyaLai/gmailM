import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockReconcileUnreadInbox } = vi.hoisted(() => ({
  mockReconcileUnreadInbox: vi.fn().mockResolvedValue({
    gmailThreadsUnread: 3, reconciled: 2, remaining: 0, failed: 0, completed: true,
  }),
}));

vi.mock("../../../lib/emailSync", () => ({
  reconcileUnreadInbox: mockReconcileUnreadInbox,
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
