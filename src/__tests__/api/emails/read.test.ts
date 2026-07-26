import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/supabase", () => ({
  getSupabase: vi.fn(),
}));

vi.mock("../../../lib/gmail", () => ({
  markAsRead: vi.fn().mockResolvedValue(undefined),
  markAsUnread: vi.fn().mockResolvedValue(undefined),
}));

import { PATCH } from "../../../pages/api/emails/[id]/read";
import { markAsRead, markAsUnread } from "../../../lib/gmail";
import { getSupabase } from "../../../lib/supabase";

function makeContext(id: string | undefined, body?: object) {
  const request = new Request("http://localhost/api/emails/msg-1/read", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { params: id !== undefined ? { id } : {}, request } as never;
}

function setupSupabase(error: unknown = null) {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error }),
  };
  vi.mocked(getSupabase).mockReturnValue({ from: vi.fn(() => chain) } as never);
}

describe("PATCH /api/emails/[id]/read", () => {
  beforeEach(() => vi.clearAllMocks());

  it("缺少 id 時應回傳 400", async () => {
    const res = await PATCH(makeContext(undefined, { read: true }));
    expect(res.status).toBe(400);
  });

  it("無效 JSON body 應預設為已讀（向後相容）", async () => {
    setupSupabase();
    const req = new Request("http://localhost/api/emails/x/read", {
      method: "PATCH",
      body: "not json",
    });
    const res = await PATCH({ params: { id: "x" }, request: req } as never);
    expect(res.status).toBe(200);
    expect(markAsRead).toHaveBeenCalledWith("x");
  });

  it("read=true 應標示為已讀並呼叫 markAsRead", async () => {
    setupSupabase();
    const res = await PATCH(makeContext("msg-1", { read: true }));
    expect(res.status).toBe(200);
    expect(markAsRead).toHaveBeenCalledWith("msg-1");
  });

  it("read=false 應標示為未讀並呼叫 markAsUnread", async () => {
    setupSupabase();
    const res = await PATCH(makeContext("msg-1", { read: false }));
    expect(res.status).toBe(200);
    expect(markAsUnread).toHaveBeenCalledWith("msg-1");
  });

  it("Supabase 失敗時應回傳 500", async () => {
    setupSupabase({ message: "db error" });
    const res = await PATCH(makeContext("msg-1", { read: true }));
    expect(res.status).toBe(500);
  });

  it("Gmail 同步失敗時應回傳 207", async () => {
    setupSupabase();
    vi.mocked(markAsRead).mockRejectedValueOnce(new Error("gmail fail"));
    const res = await PATCH(makeContext("msg-1", { read: true }));
    expect(res.status).toBe(207);
  });

  it("Gmail 同步失敗（markAsUnread）時應回傳 207", async () => {
    setupSupabase();
    vi.mocked(markAsUnread).mockRejectedValueOnce(new Error("gmail fail"));
    const res = await PATCH(makeContext("msg-1", { read: false }));
    expect(res.status).toBe(207);
  });
});
