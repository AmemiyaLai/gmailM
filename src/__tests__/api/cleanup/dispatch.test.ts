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

  it("沒有命中的郵件時應回傳 skipped", async () => {
    mockDispatchCleanupReview.mockResolvedValue({ status: "skipped", reason: "no matching emails" });
    const res = await POST({} as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "skipped", reason: "no matching emails" });
  });

  it("送出審核成功應回傳審核單資訊", async () => {
    mockDispatchCleanupReview.mockResolvedValue({ status: "ok", reviewId: "r1", emailCount: 3 });
    const res = await POST({} as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.reviewId).toBe("r1");
    expect(body.emailCount).toBe(3);
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
