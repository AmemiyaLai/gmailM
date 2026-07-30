import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetSupabase, mockUpdateAlias } = vi.hoisted(() => ({
  mockGetSupabase: vi.fn(() => ({ from: vi.fn() })),
  mockUpdateAlias: vi.fn(),
}));

vi.mock("../../../lib/supabase", () => ({
  getSupabase: mockGetSupabase,
}));

vi.mock("../../../lib/inboundEmailService", () => ({
  updateAlias: mockUpdateAlias,
}));

import { POST } from "../../../pages/api/inbound/alias";

function makeContext(body: unknown) {
  return {
    request: new Request("http://localhost/api/inbound/alias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateAlias.mockResolvedValue({ found: true });
});

describe("POST /api/inbound/alias", () => {
  it("無效 JSON 應回傳 400", async () => {
    const res = await POST(makeContext("not json"));
    expect(res.status).toBe(400);
  });

  it("缺 alias 或格式錯誤應回傳 400", async () => {
    expect((await POST(makeContext({ label: "x" }))).status).toBe(400);
    expect((await POST(makeContext({ alias: "漢字", label: "x" }))).status).toBe(400);
    expect(mockUpdateAlias).not.toHaveBeenCalled();
  });

  it("沒有可更新欄位應回傳 400", async () => {
    const res = await POST(makeContext({ alias: "blog" }));
    expect(res.status).toBe(400);
    expect(mockUpdateAlias).not.toHaveBeenCalled();
  });

  it("找不到別名回傳 404", async () => {
    mockUpdateAlias.mockResolvedValue({ found: false });
    const res = await POST(makeContext({ alias: "nope", label: "x" }));
    expect(res.status).toBe(404);
  });

  it("成功更新回傳 200，並裁切超長欄位", async () => {
    const res = await POST(
      makeContext({ alias: "Blog", label: `${"很".repeat(100)}`, site: "blog.autodesignlab.org" }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
    expect(mockUpdateAlias).toHaveBeenCalledWith(expect.anything(), "blog", {
      label: "很".repeat(64),
      site: "blog.autodesignlab.org",
    });
  });

  it("site 傳空字串時清空為 null", async () => {
    await POST(makeContext({ alias: "blog", site: "  " }));
    expect(mockUpdateAlias).toHaveBeenCalledWith(expect.anything(), "blog", { site: null });
  });

  it("服務層失敗回傳 500", async () => {
    mockUpdateAlias.mockRejectedValue(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeContext({ alias: "blog", label: "x" }));

    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });
});
