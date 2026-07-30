import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGenerateUnreadSummary, mockSendDiscordSummary } = vi.hoisted(() => ({
  mockGenerateUnreadSummary: vi.fn(),
  mockSendDiscordSummary: vi.fn(),
}));

vi.mock("../../../lib/summaryService", () => ({
  generateUnreadSummary: mockGenerateUnreadSummary,
  SummaryError: class SummaryError extends Error {
    constructor(message: string, readonly code: string) {
      super(message);
      this.name = "SummaryError";
    }
  },
}));

vi.mock("../../../lib/discord", () => ({
  sendDiscordSummary: mockSendDiscordSummary,
}));

import { POST } from "../../../pages/api/summaries/generate";

function makeContext(body: unknown) {
  const request = new Request("http://localhost/api/summaries/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request } as never;
}

describe("POST /api/summaries/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("無 body 時應使用預設 force=true, sendDiscord=false", async () => {
    mockGenerateUnreadSummary.mockResolvedValue({
      status: "ok",
      summaryText: "摘要",
      emailCount: 3,
      periodStart: new Date("2026-01-01T00:00:00Z"),
      periodEnd: new Date("2026-01-01T12:00:00Z"),
    });
    const request = new Request("http://localhost/api/summaries/generate", { method: "POST" });
    const res = await POST({ request } as never);
    expect(res.status).toBe(200);
    expect(mockGenerateUnreadSummary).toHaveBeenCalledWith({ force: true });
  });

  it("無未讀郵件時應回傳 skipped", async () => {
    mockGenerateUnreadSummary.mockResolvedValue({ status: "skipped", reason: "no unread emails" });
    const res = await POST(makeContext({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("skipped");
    expect(body.reason).toBe("no unread emails");
  });

  it("產生摘要成功且 sendDiscord=false 時應回傳 discordSent=false", async () => {
    mockGenerateUnreadSummary.mockResolvedValue({
      status: "ok",
      summaryText: "摘要",
      emailCount: 3,
      periodStart: new Date("2026-01-01T00:00:00Z"),
      periodEnd: new Date("2026-01-01T12:00:00Z"),
    });
    const res = await POST(makeContext({ sendDiscord: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.discordSent).toBe(false);
    expect(mockSendDiscordSummary).not.toHaveBeenCalled();
  });

  it("sendDiscord=true 時應發送 Discord 摘要", async () => {
    mockGenerateUnreadSummary.mockResolvedValue({
      status: "ok",
      summaryText: "摘要",
      emailCount: 3,
      periodStart: new Date("2026-01-01T00:00:00Z"),
      periodEnd: new Date("2026-01-01T12:00:00Z"),
    });
    mockSendDiscordSummary.mockResolvedValue(undefined);
    const res = await POST(makeContext({ sendDiscord: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.discordSent).toBe(true);
    expect(mockSendDiscordSummary).toHaveBeenCalledWith(
      expect.objectContaining({ summaryText: "摘要", emailCount: 3, manual: true }),
    );
  });

  it("sendDiscord=true 但 Discord 發送失敗時應回傳 discordSent=false", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGenerateUnreadSummary.mockResolvedValue({
      status: "ok",
      summaryText: "摘要",
      emailCount: 3,
      periodStart: new Date("2026-01-01T00:00:00Z"),
      periodEnd: new Date("2026-01-01T12:00:00Z"),
    });
    mockSendDiscordSummary.mockRejectedValue(new Error("Discord fail"));
    const res = await POST(makeContext({ sendDiscord: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.discordSent).toBe(false);
    consoleSpy.mockRestore();
  });

  it("Gemini 失敗時應回傳 502", async () => {
    const { SummaryError } = await import("../../../lib/summaryService");
    mockGenerateUnreadSummary.mockRejectedValue(new SummaryError("Gemini error", "gemini"));
    const res = await POST(makeContext({}));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("AI 摘要產生失敗，請稍後再試。");
  });

  it("非 SummaryError 例外應回傳 500", async () => {
    mockGenerateUnreadSummary.mockRejectedValue(new Error("Unexpected error"));
    const res = await POST(makeContext({}));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Unexpected error");
  });

  it("非 Error 例外應回傳 Unknown error", async () => {
    mockGenerateUnreadSummary.mockRejectedValue("string error");
    const res = await POST(makeContext({}));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Unknown error");
  });

  it("無效 JSON body 應回傳 400", async () => {
    const request = new Request("http://localhost/api/summaries/generate", {
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
