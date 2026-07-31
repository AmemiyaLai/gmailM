import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSetStarred, mockGetSupabase } = vi.hoisted(() => ({
  mockSetStarred: vi.fn().mockResolvedValue(undefined),
  mockGetSupabase: vi.fn(),
}));

vi.mock("../../../lib/supabase", () => ({
  getSupabase: mockGetSupabase,
}));

vi.mock("../../../lib/gmail", () => ({
  setStarred: mockSetStarred,
}));

import { PATCH } from "../../../pages/api/emails/[id]/star";
import { getSupabase } from "../../../lib/supabase";
import { setStarred } from "../../../lib/gmail";

function makeContext(id: string | undefined, body?: object, method = "PATCH") {
  const request = new Request("http://localhost/api/emails/msg-1/star", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { params: id !== undefined ? { id } : {}, request } as never;
}

function setupSupabase(opts: {
  fetchData?: { labels: string[] | null } | null;
  fetchError?: { message: string } | null;
  updateError?: { message: string } | null;
}) {
  const fetchChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: opts.fetchData ?? null, error: opts.fetchError ?? null }),
  };
  const updateChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error: opts.updateError ?? null }),
  };
  const fromMock = vi.fn()
    .mockReturnValueOnce(fetchChain)
    .mockReturnValueOnce(updateChain);
  vi.mocked(getSupabase).mockReturnValue({ from: fromMock } as never);
  return { fromMock, fetchChain, updateChain };
}

describe("PATCH /api/emails/[id]/star", () => {
  beforeEach(() => vi.clearAllMocks());

  it("缺少 id 時應回傳 400", async () => {
    const res = await PATCH(makeContext(undefined, { starred: true }));
    expect(res.status).toBe(400);
  });

  it("無效 JSON body 應回傳 400", async () => {
    const req = new Request("http://localhost/api/emails/x/star", {
      method: "PATCH",
      body: "not json",
    });
    const res = await PATCH({ params: { id: "x" }, request: req } as never);
    expect(res.status).toBe(400);
  });

  it("郵件不存在時應回傳 404", async () => {
    setupSupabase({ fetchData: null, fetchError: { message: "not found" } });
    const res = await PATCH(makeContext("msg-1", { starred: true }));
    expect(res.status).toBe(404);
  });

  it("加星時應在 labels 中加入 STARRED", async () => {
    const { updateChain } = setupSupabase({ fetchData: { labels: ["INBOX"] } });

    const res = await PATCH(makeContext("msg-1", { starred: true }));
    expect(res.status).toBe(200);

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ labels: expect.arrayContaining(["INBOX", "STARRED"]) }),
    );
  });

  it("取消加星時應從 labels 移除 STARRED", async () => {
    const { updateChain } = setupSupabase({ fetchData: { labels: ["INBOX", "STARRED"] } });

    const res = await PATCH(makeContext("msg-1", { starred: false }));
    expect(res.status).toBe(200);

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["INBOX"] }),
    );
  });

  it("Supabase 更新失敗時應回傳 500", async () => {
    setupSupabase({ fetchData: { labels: [] }, updateError: { message: "db error" } });

    const res = await PATCH(makeContext("msg-1", { starred: true }));
    expect(res.status).toBe(500);
  });

  it("Gmail 同步失敗時應回傳 502", async () => {
    setupSupabase({ fetchData: { labels: [] } });
    vi.mocked(setStarred).mockRejectedValueOnce(new Error("gmail fail"));

    const res = await PATCH(makeContext("msg-1", { starred: true }));
    expect(res.status).toBe(502);
  });

  it("labels 為 null 時應處理為空陣列", async () => {
    const { updateChain } = setupSupabase({ fetchData: { labels: null } });

    const res = await PATCH(makeContext("msg-1", { starred: true }));
    expect(res.status).toBe(200);

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["STARRED"] }),
    );
  });
});
