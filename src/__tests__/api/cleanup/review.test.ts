import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApproveReview, mockRejectReview } = vi.hoisted(() => ({
  mockApproveReview: vi.fn(),
  mockRejectReview: vi.fn(),
}));

vi.mock("../../../lib/cleanupReview", () => ({
  approveReview: mockApproveReview,
  rejectReview: mockRejectReview,
}));

import { POST } from "../../../pages/api/cleanup/review";

function makeContext(body?: unknown, raw?: string) {
  const request = new Request("http://localhost/api/cleanup/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
  return { request } as never;
}

describe("POST /api/cleanup/review", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approve 應呼叫 approveReview 並回傳結果", async () => {
    mockApproveReview.mockResolvedValue({ status: "approved", action: "trash", processedCount: 3, failedCount: 0 });

    const res = await POST(makeContext({ reviewId: "r1", decision: "approve" }));

    expect(res.status).toBe(200);
    expect(mockApproveReview).toHaveBeenCalledWith("r1");
    expect(await res.json()).toEqual({ status: "approved", action: "trash", processedCount: 3, failedCount: 0 });
  });

  it("reject 應呼叫 rejectReview", async () => {
    mockRejectReview.mockResolvedValue({ status: "rejected", action: "read", emailCount: 2 });

    const res = await POST(makeContext({ reviewId: "r1", decision: "reject" }));

    expect(mockRejectReview).toHaveBeenCalledWith("r1");
    expect((await res.json()).status).toBe("rejected");
    expect(mockApproveReview).not.toHaveBeenCalled();
  });

  it("已被處理過時應以 200 回傳 already-handled", async () => {
    mockApproveReview.mockResolvedValue({ status: "already-handled" });

    const res = await POST(makeContext({ reviewId: "r1", decision: "approve" }));

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("already-handled");
  });

  it("缺少 reviewId 應回 400", async () => {
    const res = await POST(makeContext({ decision: "approve" }));
    expect(res.status).toBe(400);
    expect(mockApproveReview).not.toHaveBeenCalled();
  });

  it("reviewId 為空字串應回 400", async () => {
    const res = await POST(makeContext({ reviewId: "", decision: "approve" }));
    expect(res.status).toBe(400);
  });

  it("decision 不合法應回 400", async () => {
    const res = await POST(makeContext({ reviewId: "r1", decision: "explode" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("approve");
    expect(mockApproveReview).not.toHaveBeenCalled();
    expect(mockRejectReview).not.toHaveBeenCalled();
  });

  it("無效 JSON body 應回 400", async () => {
    const res = await POST(makeContext(undefined, "not json"));
    expect(res.status).toBe(400);
  });

  it("處理失敗應回 500 並帶上錯誤訊息", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockApproveReview.mockRejectedValue(new Error("claimPending 查詢失敗：timeout"));

    const res = await POST(makeContext({ reviewId: "r1", decision: "approve" }));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("claimPending");
    consoleSpy.mockRestore();
  });

  it("非 Error 例外應回 500 並使用預設訊息", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockApproveReview.mockRejectedValue("boom");

    const res = await POST(makeContext({ reviewId: "r1", decision: "approve" }));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("處理失敗");
    consoleSpy.mockRestore();
  });
});
