import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpdate = vi.fn().mockReturnThis();
const mockEq = vi.fn().mockResolvedValue({ error: null });

vi.mock("../../../lib/supabase", () => ({
  getSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      update: mockUpdate.mockReturnThis(),
      eq: mockEq,
    })),
  })),
}));

import { POST } from "../../../pages/api/senders/category";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/senders/category", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/senders/category", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnThis();
  });

  it("有效 sender 和 category 應回傳 200", async () => {
    const res = await POST({ request: makeRequest({ sender: "alice@example.com", category: "devlog" }) } as never);
    expect(res.status).toBe(200);
  });

  it("無效 JSON body 應回傳 400", async () => {
    const req = new Request("http://localhost/api/senders/category", {
      method: "POST",
      body: "not json",
    });
    const res = await POST({ request: req } as never);
    expect(res.status).toBe(400);
  });

  it("缺少 sender 應回傳 400", async () => {
    const res = await POST({ request: makeRequest({ category: "devlog" }) } as never);
    expect(res.status).toBe(400);
  });

  it("缺少 category 應回傳 400", async () => {
    const res = await POST({ request: makeRequest({ sender: "a@b.com" }) } as never);
    expect(res.status).toBe(400);
  });

  it("Supabase 失敗時應回傳 500", async () => {
    mockEq.mockResolvedValueOnce({ error: { message: "db error" } });
    const res = await POST({ request: makeRequest({ sender: "a@b.com", category: "devlog" }) } as never);
    expect(res.status).toBe(500);
  });
});
