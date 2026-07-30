import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetSupabase, mockMarkInboundRead } = vi.hoisted(() => ({
  mockGetSupabase: vi.fn(() => ({ from: vi.fn() })),
  mockMarkInboundRead: vi.fn(),
}));

vi.mock("../../../lib/supabase", () => ({
  getSupabase: mockGetSupabase,
}));

vi.mock("../../../lib/inboundEmailService", () => ({
  markInboundRead: mockMarkInboundRead,
}));

import { PATCH } from "../../../pages/api/inbound/[id]/read";

function makeContext(id: string | undefined, body?: unknown) {
  return {
    params: { id },
    request: new Request("http://localhost/api/inbound/x/read", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMarkInboundRead.mockResolvedValue(undefined);
});

describe("PATCH /api/inbound/[id]/read", () => {
  it("缺少 id 應回傳 400", async () => {
    const res = await PATCH(makeContext(undefined));
    expect(res.status).toBe(400);
    expect(mockMarkInboundRead).not.toHaveBeenCalled();
  });

  it("無 body 時預設標記已讀", async () => {
    const res = await PATCH(makeContext("uuid-1"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok", read: true });
    expect(mockMarkInboundRead).toHaveBeenCalledWith(expect.anything(), "uuid-1", true);
  });

  it("read: false 標記為未讀", async () => {
    const res = await PATCH(makeContext("uuid-1", { read: false }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok", read: false });
    expect(mockMarkInboundRead).toHaveBeenCalledWith(expect.anything(), "uuid-1", false);
  });

  it("服務層失敗回傳 500", async () => {
    mockMarkInboundRead.mockRejectedValue(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await PATCH(makeContext("uuid-1"));

    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });
});
