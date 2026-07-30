import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("CRON_SECRET", "test-secret");

const { mockBackfillSenderTrust, mockGetSupabase } = vi.hoisted(() => ({
  mockBackfillSenderTrust: vi.fn(),
  mockGetSupabase: vi.fn(() => ({ from: vi.fn() })),
}));

vi.mock("../../../lib/senderTrustService", () => ({
  backfillSenderTrust: mockBackfillSenderTrust,
}));

vi.mock("../../../lib/supabase", () => ({
  getSupabase: mockGetSupabase,
}));

import { GET } from "../../../pages/api/gmail/sender-trust-backfill";

function makeContext(authHeader?: string, search = "") {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  const href = `http://localhost/api/gmail/sender-trust-backfill${search}`;
  return { request: new Request(href, { headers }), url: new URL(href) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBackfillSenderTrust.mockResolvedValue({
    scanned: 3,
    fetched: 2,
    assessed: 3,
    failed: 0,
    remaining: 7,
  });
});

describe("GET /api/gmail/sender-trust-backfill", () => {
  it("無 Authorization header 應回傳 401", async () => {
    const res = await GET(makeContext());
    expect(res.status).toBe(401);
    expect(mockBackfillSenderTrust).not.toHaveBeenCalled();
  });

  it("Bearer token 錯誤時應回傳 401", async () => {
    const res = await GET(makeContext("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("正確的 secret 應回傳 200 與回填統計", async () => {
    const res = await GET(makeContext("Bearer test-secret"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      scanned: 3,
      fetched: 2,
      assessed: 3,
      failed: 0,
      remaining: 7,
    });
  });

  it("未指定 limit 時應使用預設值 50", async () => {
    await GET(makeContext("Bearer test-secret"));
    expect(mockBackfillSenderTrust).toHaveBeenCalledWith(expect.anything(), {
      limit: 50,
      force: false,
    });
  });

  it("limit 應被夾在 1–200 之間", async () => {
    await GET(makeContext("Bearer test-secret", "?limit=999"));
    expect(mockBackfillSenderTrust).toHaveBeenCalledWith(expect.anything(), {
      limit: 200,
      force: false,
    });
  });

  it("非法的 limit 應退回預設值", async () => {
    await GET(makeContext("Bearer test-secret", "?limit=abc"));
    expect(mockBackfillSenderTrust).toHaveBeenCalledWith(expect.anything(), {
      limit: 50,
      force: false,
    });
  });

  it("force=true 應傳遞給服務層", async () => {
    await GET(makeContext("Bearer test-secret", "?force=true"));
    expect(mockBackfillSenderTrust).toHaveBeenCalledWith(expect.anything(), {
      limit: 50,
      force: true,
    });
  });

  it("服務層拋出錯誤時應回傳 500", async () => {
    mockBackfillSenderTrust.mockRejectedValue(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });
});
