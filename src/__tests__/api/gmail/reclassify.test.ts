import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockReclassifyEmails } = vi.hoisted(() => ({
  mockReclassifyEmails: vi.fn().mockResolvedValue({ total: 800, updated: 650, unchanged: 150 }),
}));

vi.mock("../../../lib/reclassify", () => ({
  reclassifyEmails: mockReclassifyEmails,
}));

import { GET } from "../../../pages/api/gmail/reclassify";

function makeContext(opts?: { authorization?: string }) {
  const url = new URL("http://localhost/api/gmail/reclassify");
  const headers = new Headers();
  if (opts?.authorization) headers.set("authorization", opts.authorization);
  const request = new Request(url.toString(), { method: "GET", headers });
  return { request, url } as never;
}

describe("GET /api/gmail/reclassify", () => {
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

  it("有效授權時應執行重新分類並回傳統計", async () => {
    const res = await GET(makeContext({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(mockReclassifyEmails).toHaveBeenCalled();
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.total).toBe(800);
    expect(body.updated).toBe(650);
    expect(body.unchanged).toBe(150);
  });

  it("重新分類失敗時應回傳 500", async () => {
    mockReclassifyEmails.mockRejectedValueOnce(new Error("db error"));
    const res = await GET(makeContext({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("db error");
  });
});
