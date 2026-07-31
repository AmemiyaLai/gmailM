import { describe, it, expect, vi, beforeEach } from "vitest";

const mockIn = vi.fn().mockResolvedValue({ error: null });
const mockUpdate = vi.fn().mockReturnValue({ in: mockIn });
const mockDelete = vi.fn().mockReturnValue({ in: mockIn });
const mockFrom = vi.fn(() => ({ update: mockUpdate, delete: mockDelete }));

vi.mock("../../../lib/supabase", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("../../../lib/gmail", () => ({
  markAsRead: vi.fn().mockResolvedValue(undefined),
  archiveMessage: vi.fn().mockResolvedValue(undefined),
  trashMessage: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "../../../pages/api/emails/bulk";
import { markAsRead, archiveMessage, trashMessage } from "../../../lib/gmail";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/emails/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/emails/bulk", () => {
  beforeEach(() => vi.clearAllMocks());

  it("無效 JSON body 應回傳 400", async () => {
    const req = new Request("http://localhost/api/emails/bulk", {
      method: "POST",
      body: "not json",
    });
    const res = await POST({ request: req } as never);
    expect(res.status).toBe(400);
  });

  it("空 ids 陣列應回傳 400", async () => {
    const res = await POST({ request: makeRequest({ ids: [], action: "read" }) } as never);
    expect(res.status).toBe(400);
  });

  it("無效 action 應回傳 400", async () => {
    const res = await POST({ request: makeRequest({ ids: ["a"], action: "invalid" }) } as never);
    expect(res.status).toBe(400);
  });

  it("缺少 action 應回傳 400", async () => {
    const res = await POST({ request: makeRequest({ ids: ["a"] }) } as never);
    expect(res.status).toBe(400);
  });

  it("action=read 應更新 is_read 並呼叫 markAsRead", async () => {
    const res = await POST({ request: makeRequest({ ids: ["a", "b"], action: "read" }) } as never);
    expect(res.status).toBe(200);
    expect(markAsRead).toHaveBeenCalledTimes(2);

    const body = await res.json();
    expect(body.succeeded).toEqual(["a", "b"]);
    expect(body.gmailFailed).toEqual([]);
  });

  it("action=archive 應刪除記錄並呼叫 archiveMessage", async () => {
    const res = await POST({ request: makeRequest({ ids: ["a"], action: "archive" }) } as never);
    expect(res.status).toBe(200);
    expect(archiveMessage).toHaveBeenCalledWith("a");
  });

  it("action=trash 應刪除記錄並呼叫 trashMessage", async () => {
    const res = await POST({ request: makeRequest({ ids: ["a"], action: "trash" }) } as never);
    expect(res.status).toBe(200);
    expect(trashMessage).toHaveBeenCalledWith("a");
  });

  it("Gmail 部分失敗時應在 gmailFailed 中列出", async () => {
    vi.mocked(markAsRead)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("gmail fail"));

    const res = await POST({ request: makeRequest({ ids: ["a", "b"], action: "read" }) } as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.succeeded).toEqual(["a"]);
    expect(body.gmailFailed).toEqual(["b"]);
  });

  it("Supabase 失敗時應回傳 500", async () => {
    mockIn.mockResolvedValueOnce({ error: { message: "db error" } });

    const res = await POST({ request: makeRequest({ ids: ["a"], action: "read" }) } as never);
    expect(res.status).toBe(500);
  });

  it("非字串的 ids 應被過濾", async () => {
    const res = await POST({ request: makeRequest({ ids: ["a", 123, null, "b"], action: "read" }) } as never);
    expect(res.status).toBe(200);
    expect(markAsRead).toHaveBeenCalledTimes(2);
  });
});
