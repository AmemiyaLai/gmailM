import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSendSummaryToDiscord } = vi.hoisted(() => ({
  mockSendSummaryToDiscord: vi.fn(),
}));

vi.mock("../../../lib/summaryService", () => ({
  sendSummaryToDiscord: mockSendSummaryToDiscord,
  SummaryError: class SummaryError extends Error {
    constructor(message: string, readonly code: string) {
      super(message);
      this.name = "SummaryError";
    }
  },
}));

import { POST } from "../../../pages/api/summaries/send-discord";

function makeContext(body: unknown) {
  const request = new Request("http://localhost/api/summaries/send-discord", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request } as never;
}

describe("POST /api/summaries/send-discord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未指定 summaryId 時應發送最新一筆摘要", async () => {
    mockSendSummaryToDiscord.mockResolvedValue({
      summaryText: "摘要",
      emailCount: 5,
      periodStart: new Date("2026-01-01T00:00:00Z"),
      periodEnd: new Date("2026-01-01T12:00:00Z"),
    });
    const res = await POST(makeContext({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.emailCount).toBe(5);
    expect(mockSendSummaryToDiscord).toHaveBeenCalledWith(undefined);
  });

  it("指定 summaryId 時應使用該 id", async () => {
    mockSendSummaryToDiscord.mockResolvedValue({
      summaryText: "摘要",
      emailCount: 3,
      periodStart: new Date(),
      periodEnd: new Date(),
    });
    await POST(makeContext({ summaryId: "s1" }));
    expect(mockSendSummaryToDiscord).toHaveBeenCalledWith("s1");
  });

  it("找不到摘要時應回傳 404", async () => {
    const { SummaryError } = await import("../../../lib/summaryService");
    mockSendSummaryToDiscord.mockRejectedValue(new SummaryError("Summary not found", "db"));
    const res = await POST(makeContext({}));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("找不到指定的摘要記錄。");
  });

  it("其他 SummaryError 應回傳 500", async () => {
    const { SummaryError } = await import("../../../lib/summaryService");
    mockSendSummaryToDiscord.mockRejectedValue(new SummaryError("DISCORD_WEBHOOK_URL is not configured", "db"));
    const res = await POST(makeContext({}));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("DISCORD_WEBHOOK_URL is not configured");
  });

  it("非 SummaryError 例外應回傳 502", async () => {
    mockSendSummaryToDiscord.mockRejectedValue(new Error("Network error"));
    const res = await POST(makeContext({}));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Network error");
  });

  it("非 Error 例外應回傳 Unknown error", async () => {
    mockSendSummaryToDiscord.mockRejectedValue("string error");
    const res = await POST(makeContext({}));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Unknown error");
  });

  it("無效 JSON body 應回傳 400", async () => {
    const request = new Request("http://localhost/api/summaries/send-discord", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid json",
    });
    const res = await POST({ request } as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });
});
