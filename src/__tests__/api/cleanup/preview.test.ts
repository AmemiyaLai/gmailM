import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPreviewKeyword, mockIsCleanupField } = vi.hoisted(() => ({
  mockPreviewKeyword: vi.fn(),
  mockIsCleanupField: vi.fn(),
}));

vi.mock("../../../lib/cleanupKeywords", () => ({
  previewKeyword: mockPreviewKeyword,
  isCleanupField: mockIsCleanupField,
}));

import { GET } from "../../../pages/api/cleanup/preview";

describe("GET /api/cleanup/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCleanupField.mockReturnValue(true);
  });

  it("關鍵字為空時應回傳空結果", async () => {
    const url = new URL("http://localhost/api/cleanup/preview?keyword=&field=any");
    const res = await GET({ url } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.emails).toEqual([]);
    expect(mockPreviewKeyword).not.toHaveBeenCalled();
  });

  it("應呼叫 previewKeyword 並回傳結果", async () => {
    mockPreviewKeyword.mockResolvedValue({
      total: 2,
      emails: [{ id: "1", sender: "a@x.com", subject: "優惠", snippet: "" }],
    });
    const url = new URL("http://localhost/api/cleanup/preview?keyword=優惠&field=subject");
    const res = await GET({ url } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(mockPreviewKeyword).toHaveBeenCalledWith("優惠", "subject");
  });

  it("無效欄位時應降級為 any", async () => {
    mockIsCleanupField.mockReturnValue(false);
    mockPreviewKeyword.mockResolvedValue({ total: 0, emails: [] });
    const url = new URL("http://localhost/api/cleanup/preview?keyword=test&field=invalid");
    await GET({ url } as never);
    expect(mockPreviewKeyword).toHaveBeenCalledWith("test", "any");
  });

  it("未提供 field 時應使用預設 any", async () => {
    mockPreviewKeyword.mockResolvedValue({ total: 0, emails: [] });
    const url = new URL("http://localhost/api/cleanup/preview?keyword=test");
    await GET({ url } as never);
    expect(mockPreviewKeyword).toHaveBeenCalledWith("test", "any");
  });

  it("關鍵字只有空白時應回傳空結果", async () => {
    const url = new URL("http://localhost/api/cleanup/preview?keyword=%20%20");
    const res = await GET({ url } as never);
    const body = await res.json();
    expect(body.total).toBe(0);
  });
});
