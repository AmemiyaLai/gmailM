import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockStartWatch, mockGetSupabase } = vi.hoisted(() => ({
  mockStartWatch: vi.fn().mockResolvedValue({ historyId: "123", expiration: "1700000000000" }),
  mockGetSupabase: vi.fn(),
}));

vi.mock("../../../lib/gmail", () => ({
  startWatch: mockStartWatch,
}));

vi.mock("../../../lib/supabase", () => ({
  getSupabase: mockGetSupabase,
}));

import { GET } from "../../../pages/api/gmail/watch-renew";

function makeContext(authHeader?: string) {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  const request = new Request("http://localhost/api/gmail/watch-renew", { headers });
  return { request } as never;
}

function setupSupabase(opts?: { existingHistoryId?: number | null }) {
  const selectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: opts?.existingHistoryId !== undefined ? { last_history_id: opts.existingHistoryId } : null,
      error: null,
    }),
  };
  const upsertChain = {
    upsert: vi.fn().mockResolvedValue({ error: null }),
  };
  const fromMock = vi.fn()
    .mockReturnValueOnce(selectChain)
    .mockReturnValueOnce(upsertChain);
  mockGetSupabase.mockReturnValue({ from: fromMock } as never);
  return { selectChain, upsertChain };
}

describe("GET /api/gmail/watch-renew", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.stubEnv("GMAIL_AUTOMATION_ENABLED", "true");
    vi.stubEnv("GMAIL_WATCH_ADDRESS", "me@gmail.com");
  });

  it("無 Authorization header 應回傳 401", async () => {
    const res = await GET(makeContext());
    expect(res.status).toBe(401);
  });

  it("Authorization 不符時應回傳 401", async () => {
    const res = await GET(makeContext("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("自動化暫停時不應續訂 Gmail watch", async () => {
    vi.stubEnv("GMAIL_AUTOMATION_ENABLED", "false");
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "paused" });
    expect(mockStartWatch).not.toHaveBeenCalled();
  });

  it("有效授權時應執行 startWatch 並回傳結果", async () => {
    const { upsertChain } = setupSupabase();
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(mockStartWatch).toHaveBeenCalled();
    expect(upsertChain.upsert).toHaveBeenCalled();
    const body = await res.json();
    expect(body.historyId).toBe("123");
  });

  it("已有 last_history_id 時不應覆蓋它", async () => {
    const { upsertChain } = setupSupabase({ existingHistoryId: 999 });
    await GET(makeContext("Bearer test-secret"));
    const upsertCall = upsertChain.upsert.mock.calls[0][0];
    expect(upsertCall).not.toHaveProperty("last_history_id");
  });

  it("無 existing record 時應設定 last_history_id", async () => {
    const { upsertChain } = setupSupabase({ existingHistoryId: null });
    await GET(makeContext("Bearer test-secret"));
    const upsertCall = upsertChain.upsert.mock.calls[0][0];
    expect(upsertCall.last_history_id).toBe(123);
  });

  it("GMAIL_WATCH_ADDRESS 未設定時應回傳 500", async () => {
    vi.stubEnv("GMAIL_WATCH_ADDRESS", "");
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(500);
    expect(mockStartWatch).not.toHaveBeenCalled();
  });

  it("startWatch 失敗時應回傳 500", async () => {
    mockStartWatch.mockRejectedValueOnce(new Error("watch error"));
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(500);
  });
});
