import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSyncEmailsFromGmail } = vi.hoisted(() => ({
  mockSyncEmailsFromGmail: vi.fn().mockResolvedValue({ imported: 10, failed: 1 }),
}));

vi.mock("../../../lib/emailSync", () => ({
  syncEmailsFromGmail: mockSyncEmailsFromGmail,
}));

import { GET } from "../../../pages/api/gmail/backfill";

function makeContext(opts?: { authorization?: string; limit?: string }) {
  const url = new URL("http://localhost/api/gmail/backfill");
  if (opts?.limit) url.searchParams.set("limit", opts.limit);

  const headers = new Headers();
  if (opts?.authorization) headers.set("authorization", opts.authorization);

  const request = new Request(url.toString(), { method: "GET", headers });
  return { request, url } as never;
}

describe("GET /api/gmail/backfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
  });

  it("無 Authorization header 應回傳 401", async () => {
    const res = await GET(makeContext({}));
    expect(res.status).toBe(401);
  });

  it("Authorization 不符時應回傳 401", async () => {
    const res = await GET(makeContext({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("有效授權時應執行同步並回傳結果", async () => {
    const res = await GET(makeContext({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(mockSyncEmailsFromGmail).toHaveBeenCalled();
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.imported).toBe(10);
  });

  it("limit 參數應傳遞給 syncEmailsFromGmail", async () => {
    await GET(makeContext({ authorization: "Bearer test-secret", limit: "200" }));
    expect(mockSyncEmailsFromGmail).toHaveBeenCalledWith(200);
  });

  it("limit 超過 1000 應限制為 1000", async () => {
    await GET(makeContext({ authorization: "Bearer test-secret", limit: "5000" }));
    expect(mockSyncEmailsFromGmail).toHaveBeenCalledWith(1000);
  });

  it("無 limit 時應使用預設值 50", async () => {
    await GET(makeContext({ authorization: "Bearer test-secret" }));
    expect(mockSyncEmailsFromGmail).toHaveBeenCalledWith(50);
  });

  it("同步失敗時應回傳 500", async () => {
    mockSyncEmailsFromGmail.mockRejectedValueOnce(new Error("sync error"));
    const res = await GET(makeContext({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("sync error");
  });
});
