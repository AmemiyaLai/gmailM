import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDispatchCleanupReview } = vi.hoisted(() => ({ mockDispatchCleanupReview: vi.fn() }));

vi.mock("../../../lib/cleanupReview", () => ({
  dispatchCleanupReview: mockDispatchCleanupReview,
}));

import { GET } from "../../../pages/api/gmail/cleanup-scan";

function makeContext(authHeader?: string) {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  const request = new Request("http://localhost/api/gmail/cleanup-scan", { headers });
  return { request } as never;
}

describe("GET /api/gmail/cleanup-scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
  });

  it("無 Authorization header 應回傳 401", async () => {
    const res = await GET(makeContext());
    expect(res.status).toBe(401);
    expect(mockDispatchCleanupReview).not.toHaveBeenCalled();
  });

  it("Authorization 不符時應回傳 401", async () => {
    const res = await GET(makeContext("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("沒有命中的郵件時應回傳 skipped", async () => {
    mockDispatchCleanupReview.mockResolvedValue({ status: "skipped", reason: "no matching emails" });
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "skipped", reason: "no matching emails" });
  });

  it("送出審核後應回傳審核單資訊", async () => {
    mockDispatchCleanupReview.mockResolvedValue({ status: "ok", reviewId: "review-1", emailCount: 4 });
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.emailCount).toBe(4);
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
