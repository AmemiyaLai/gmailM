import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSyncEmailsFromGmail } = vi.hoisted(() => ({
  mockSyncEmailsFromGmail: vi.fn().mockResolvedValue({ imported: 3, failed: 0 }),
}));

vi.mock("../../../lib/emailSync", () => ({
  syncEmailsFromGmail: mockSyncEmailsFromGmail,
}));

import { POST } from "../../../pages/api/gmail/sync";

describe("POST /api/gmail/sync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("手動同步成功時應回傳 imported 和 failed", async () => {
    const res = await POST({} as never);
    expect(res.status).toBe(200);
    expect(mockSyncEmailsFromGmail).toHaveBeenCalledWith(50);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.imported).toBe(3);
    expect(body.failed).toBe(0);
  });

  it("同步失敗時應回傳 500", async () => {
    mockSyncEmailsFromGmail.mockRejectedValueOnce(new Error("Gmail API error"));
    const res = await POST({} as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Gmail API error");
  });

  it("非 Error 例外應回傳 Unknown error", async () => {
    mockSyncEmailsFromGmail.mockRejectedValueOnce("string error");
    const res = await POST({} as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Unknown error");
  });
});
