import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockProcessCandidatesNow } = vi.hoisted(() => ({
  mockProcessCandidatesNow: vi.fn(),
}));

vi.mock("../../../lib/cleanupReview", () => ({
  processCandidatesNow: mockProcessCandidatesNow,
}));

// isCleanupAction 是純粹的型別守衛，保留真實實作
vi.mock("../../../lib/cleanupKeywords", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/cleanupKeywords")>("../../../lib/cleanupKeywords");
  return { isCleanupAction: actual.isCleanupAction };
});

import { POST } from "../../../pages/api/cleanup/process-now";

function makeContext(body?: unknown, raw?: string) {
  const request = new Request("http://localhost/api/cleanup/process-now", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
  return { request } as never;
}

describe("POST /api/cleanup/process-now", () => {
  beforeEach(() => vi.clearAllMocks());

  it("trash 應呼叫 processCandidatesNow 並回傳結果", async () => {
    mockProcessCandidatesNow.mockResolvedValue({
      status: "ok", action: "trash", reviewId: "r1", processedCount: 5, failedCount: 0,
    });

    const res = await POST(makeContext({ action: "trash" }));

    expect(res.status).toBe(200);
    expect(mockProcessCandidatesNow).toHaveBeenCalledWith("trash");
    expect((await res.json()).processedCount).toBe(5);
  });

  it("read 也應正常受理", async () => {
    mockProcessCandidatesNow.mockResolvedValue({
      status: "ok", action: "read", reviewId: "r2", processedCount: 9, failedCount: 0,
    });

    const res = await POST(makeContext({ action: "read" }));

    expect(mockProcessCandidatesNow).toHaveBeenCalledWith("read");
    expect((await res.json()).action).toBe("read");
  });

  it("沒有候選時應以 200 回傳 skipped", async () => {
    mockProcessCandidatesNow.mockResolvedValue({ status: "skipped", reason: "no matching emails" });

    const res = await POST(makeContext({ action: "trash" }));

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("skipped");
  });

  it("action 不合法應回 400", async () => {
    const res = await POST(makeContext({ action: "archive" }));
    expect(res.status).toBe(400);
    expect(mockProcessCandidatesNow).not.toHaveBeenCalled();
  });

  it("缺少 action 應回 400", async () => {
    const res = await POST(makeContext({}));
    expect(res.status).toBe(400);
  });

  it("無效 JSON body 應回 400", async () => {
    const res = await POST(makeContext(undefined, "not json"));
    expect(res.status).toBe(400);
  });

  it("處理失敗應回 500", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockProcessCandidatesNow.mockRejectedValue(new Error("Gmail 配額用盡"));

    const res = await POST(makeContext({ action: "trash" }));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Gmail 配額用盡");
    consoleSpy.mockRestore();
  });

  it("非 Error 例外應回 500 並使用預設訊息", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockProcessCandidatesNow.mockRejectedValue("boom");

    const res = await POST(makeContext({ action: "read" }));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("處理失敗");
    consoleSpy.mockRestore();
  });
});
