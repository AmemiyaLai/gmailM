import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("CRON_SECRET", "test-secret");

const { mockGetSupabase, mockGetInboundDigestStats, mockSendInboundDigest } = vi.hoisted(() => ({
  mockGetSupabase: vi.fn(() => ({ from: vi.fn() })),
  mockGetInboundDigestStats: vi.fn(),
  mockSendInboundDigest: vi.fn(),
}));

vi.mock("../../../lib/supabase", () => ({
  getSupabase: mockGetSupabase,
}));

vi.mock("../../../lib/inboundEmailService", () => ({
  getInboundDigestStats: mockGetInboundDigestStats,
}));

vi.mock("../../../lib/discord", () => ({
  sendInboundDigest: mockSendInboundDigest,
}));

import { GET } from "../../../pages/api/inbound/digest";

function makeContext(authHeader?: string) {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return { request: new Request("http://localhost/api/inbound/digest", { headers }) } as never;
}

const STATS = {
  total: 3,
  unreadTotal: 2,
  perAlias: [{ alias: "blog", label: "部落格", count: 3 }],
  topSenders: [{ fromAddress: "a@x.com", count: 3 }],
  notableSubjects: ["主旨"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetInboundDigestStats.mockResolvedValue(STATS);
  mockSendInboundDigest.mockResolvedValue(undefined);
});

describe("GET /api/inbound/digest", () => {
  it("無 Authorization header 應回傳 401", async () => {
    const res = await GET(makeContext());
    expect(res.status).toBe(401);
    expect(mockGetInboundDigestStats).not.toHaveBeenCalled();
  });

  it("Bearer token 錯誤時應回傳 401", async () => {
    const res = await GET(makeContext("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("零新信時回傳 skipped 且不發送 Discord", async () => {
    mockGetInboundDigestStats.mockResolvedValue({ ...STATS, total: 0 });

    const res = await GET(makeContext("Bearer test-secret"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "skipped", reason: "no new inbound mail" });
    expect(mockSendInboundDigest).not.toHaveBeenCalled();
  });

  it("有新信時發送摘要並回傳統計", async () => {
    const res = await GET(makeContext("Bearer test-secret"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok", total: 3, unread: 2 });
    expect(mockSendInboundDigest).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 3,
        unreadTotal: 2,
        periodStart: expect.any(Date),
        periodEnd: expect.any(Date),
      }),
    );
  });

  it("摘要窗口為 13 小時", async () => {
    await GET(makeContext("Bearer test-secret"));

    const sinceIso = mockGetInboundDigestStats.mock.calls[0][1] as string;
    const windowMs = Date.now() - new Date(sinceIso).getTime();
    expect(windowMs).toBeGreaterThan(12.9 * 60 * 60 * 1000);
    expect(windowMs).toBeLessThan(13.1 * 60 * 60 * 1000);
  });

  it("Discord 發送失敗仍回傳 200", async () => {
    mockSendInboundDigest.mockRejectedValue(new Error("discord down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(makeContext("Bearer test-secret"));

    expect(res.status).toBe(200);
    errorSpy.mockRestore();
  });

  it("統計查詢失敗回傳 500", async () => {
    mockGetInboundDigestStats.mockRejectedValue(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(makeContext("Bearer test-secret"));

    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });
});
