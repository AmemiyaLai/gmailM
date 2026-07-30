import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDispatchCleanupReview, mockResumeStuckReviews } = vi.hoisted(() => ({
  mockDispatchCleanupReview: vi.fn(),
  mockResumeStuckReviews: vi.fn(),
}));

vi.mock("../../../lib/cleanupReview", () => ({
  dispatchCleanupReview: mockDispatchCleanupReview,
  resumeStuckReviews: mockResumeStuckReviews,
}));

import { GET } from "../../../pages/api/gmail/cleanup-scan";

function makeContext(authHeader?: string) {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  const request = new Request("http://localhost/api/gmail/cleanup-scan", { headers });
  return { request } as never;
}

const NO_STUCK = { resumed: 0, processed: 0 };

describe("GET /api/gmail/cleanup-scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
    mockResumeStuckReviews.mockResolvedValue(NO_STUCK);
  });

  it("無 Authorization header 應回傳 401", async () => {
    const res = await GET(makeContext());
    expect(res.status).toBe(401);
    expect(mockDispatchCleanupReview).not.toHaveBeenCalled();
    expect(mockResumeStuckReviews).not.toHaveBeenCalled();
  });

  it("Authorization 不符時應回傳 401", async () => {
    const res = await GET(makeContext("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("沒有命中的郵件時應回傳 skipped", async () => {
    mockDispatchCleanupReview.mockResolvedValue({
      results: [
        { action: "trash", status: "skipped", reason: "no matching emails" },
        { action: "read", status: "skipped", reason: "no matching emails" },
      ],
    });

    const res = await GET(makeContext("Bearer test-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(2);
    expect(body.resumed).toEqual(NO_STUCK);
  });

  it("送出審核後應回傳審核單資訊", async () => {
    mockDispatchCleanupReview.mockResolvedValue({
      results: [{ action: "trash", status: "ok", reviewId: "review-1", emailCount: 4 }],
    });

    const res = await GET(makeContext("Bearer test-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0]).toEqual({ action: "trash", status: "ok", reviewId: "review-1", emailCount: 4 });
  });

  it("應先補做中斷的審核單再進行掃描，並回報補做結果", async () => {
    const order: string[] = [];
    mockResumeStuckReviews.mockImplementation(async () => {
      order.push("resume");
      return { resumed: 2, processed: 7 };
    });
    mockDispatchCleanupReview.mockImplementation(async () => {
      order.push("dispatch");
      return { results: [] };
    });

    const res = await GET(makeContext("Bearer test-secret"));

    expect(order).toEqual(["resume", "dispatch"]);
    expect((await res.json()).resumed).toEqual({ resumed: 2, processed: 7 });
  });

  it("補做失敗不應阻擋本輪掃描", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockResumeStuckReviews.mockRejectedValue(new Error("DB down"));
    mockDispatchCleanupReview.mockResolvedValue({ results: [] });

    const res = await GET(makeContext("Bearer test-secret"));

    expect(res.status).toBe(200);
    expect(mockDispatchCleanupReview).toHaveBeenCalled();
    expect((await res.json()).resumed).toEqual(NO_STUCK);
    consoleSpy.mockRestore();
  });

  it("內部錯誤時應回傳 500", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDispatchCleanupReview.mockRejectedValue(new Error("Discord 未設定"));
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe("Discord 未設定");
    consoleSpy.mockRestore();
  });
});
