import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSendFirstSenderDigest, mockGetSupabase } = vi.hoisted(() => ({
  mockSendFirstSenderDigest: vi.fn(),
  mockGetSupabase: vi.fn().mockReturnValue({}),
}));

vi.mock("../../../lib/supabase", () => ({
  getSupabase: mockGetSupabase,
}));

vi.mock("../../../lib/firstSender", () => ({
  sendFirstSenderDigest: mockSendFirstSenderDigest,
}));

import { GET } from "../../../pages/api/gmail/first-sender-digest";

function makeContext(authHeader?: string) {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  const request = new Request("http://localhost/api/gmail/first-sender-digest", { headers });
  return { request } as never;
}

describe("GET /api/gmail/first-sender-digest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
    mockSendFirstSenderDigest.mockResolvedValue({ pending: 0, sent: false });
  });

  it("無 Authorization header 應回傳 401", async () => {
    const res = await GET(makeContext());
    expect(res.status).toBe(401);
    expect(mockSendFirstSenderDigest).not.toHaveBeenCalled();
  });

  it("Authorization 不符時應回傳 401", async () => {
    const res = await GET(makeContext("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(mockSendFirstSenderDigest).not.toHaveBeenCalled();
  });

  it("沒有待通知事件時應回傳 sent: false", async () => {
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", pending: 0, sent: false });
  });

  it("有待通知事件時應回傳摘要結果", async () => {
    mockSendFirstSenderDigest.mockResolvedValue({ pending: 7, sent: true });
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", pending: 7, sent: true });
    expect(mockSendFirstSenderDigest).toHaveBeenCalledTimes(1);
  });

  it("摘要流程拋出例外時應回傳 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSendFirstSenderDigest.mockRejectedValue(new Error("db error"));
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });
});
