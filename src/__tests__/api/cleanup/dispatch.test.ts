import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDispatchCleanupReview } = vi.hoisted(() => ({
  mockDispatchCleanupReview: vi.fn(),
}));

vi.mock("../../../lib/cleanupReview", () => ({
  dispatchCleanupReview: mockDispatchCleanupReview,
}));

import { POST } from "../../../pages/api/cleanup/dispatch";

describe("POST /api/cleanup/dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("沒有命中的郵件時兩條審核線應各自回報 skipped", async () => {
    mockDispatchCleanupReview.mockResolvedValue({
      results: [
        { action: "trash", status: "skipped", reason: "no matching emails" },
        { action: "read", status: "skipped", reason: "no matching emails" },
      ],
    });

    const res = await POST({} as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(2);
    expect(body.results.every((r: { status: string }) => r.status === "skipped")).toBe(true);
  });

  it("送出審核成功應回傳各條審核線的審核單資訊", async () => {
    mockDispatchCleanupReview.mockResolvedValue({
      results: [
        { action: "trash", status: "ok", reviewId: "r1", emailCount: 3 },
        { action: "read", status: "ok", reviewId: "r2", emailCount: 5 },
      ],
    });

    const res = await POST({} as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0]).toEqual({ action: "trash", status: "ok", reviewId: "r1", emailCount: 3 });
    expect(body.results[1]).toEqual({ action: "read", status: "ok", reviewId: "r2", emailCount: 5 });
  });

  it("命中冷卻期時應回傳 429 並帶 Retry-After", async () => {
    mockDispatchCleanupReview.mockResolvedValue({
      cooldown: { retryAfterMs: 3200 },
      results: [
        { action: "trash", status: "skipped", reason: "cooldown" },
        { action: "read", status: "skipped", reason: "cooldown" },
      ],
    });

    const res = await POST({} as never);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("4"); // 3200ms 進位成 4 秒
    const body = await res.json();
    expect(body.retryAfterMs).toBe(3200);
    expect(body.error).toContain("過於頻繁");
  });

  it("dispatch 失敗時應回傳 500", async () => {
    mockDispatchCleanupReview.mockRejectedValue(new Error("Discord error"));
    const res = await POST({} as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Discord error");
  });

  it("非 Error 例外應回傳送出失敗", async () => {
    mockDispatchCleanupReview.mockRejectedValue("string error");
    const res = await POST({} as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("送出失敗");
  });
});
