import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn().mockResolvedValue({ error: null });

vi.mock("../lib/supabase", () => ({
  getSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mockSelect,
      update: mockUpdate,
    })),
  })),
}));

import { reclassifyEmails } from "../lib/reclassify";

function rangeResult(rows: { id: string; sender: string; subject: string; category: string | null }[]) {
  return { range: vi.fn().mockResolvedValue({ data: rows, error: null }) };
}

describe("reclassifyEmails()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReset();
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockEq.mockResolvedValue({ error: null });
  });

  it("category 不同時應更新為新分類", async () => {
    mockSelect.mockReturnValueOnce(
      rangeResult([
        { id: "1", sender: "noreply@github.com", subject: "PR", category: "uncategorized" },
      ]),
    );

    const result = await reclassifyEmails();

    expect(result.total).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(0);
    expect(mockUpdate).toHaveBeenCalledWith({ category: "devlog" });
    expect(mockEq).toHaveBeenCalledWith("id", "1");
  });

  it("category 相同時不應更新", async () => {
    mockSelect.mockReturnValueOnce(
      rangeResult([
        { id: "1", sender: "noreply@github.com", subject: "PR", category: "devlog" },
      ]),
    );

    const result = await reclassifyEmails();

    expect(result.total).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("select 回傳 error 時應拋出", async () => {
    mockSelect.mockReturnValueOnce({ range: vi.fn().mockResolvedValue({ data: null, error: { message: "select error" } }) });
    await expect(reclassifyEmails()).rejects.toThrow();
  });

  it("update 回傳 error 時應拋出", async () => {
    mockSelect.mockReturnValueOnce(
      rangeResult([
        { id: "1", sender: "noreply@github.com", subject: "PR", category: "uncategorized" },
      ]),
    );
    mockEq.mockResolvedValue({ error: { message: "update error" } });
    await expect(reclassifyEmails()).rejects.toThrow();
  });

  it("空結果集應回傳 0", async () => {
    mockSelect.mockReturnValueOnce(rangeResult([]));
    const result = await reclassifyEmails();
    expect(result).toEqual({ total: 0, updated: 0, unchanged: 0 });
  });

  it("應分頁抓取直到沒有更多資料", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => ({
      id: String(i),
      sender: "friend@example.com",
      subject: "hi",
      category: "uncategorized",
    }));

    mockSelect
      .mockReturnValueOnce(rangeResult(page1))
      .mockReturnValueOnce(rangeResult([]));

    const result = await reclassifyEmails();

    expect(result.total).toBe(500);
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });
});
