import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGenerateUnreadSummary, mockSendSummaryToDiscord, mockSendDiscordSummary } = vi.hoisted(() => ({
  mockGenerateUnreadSummary: vi.fn(),
  mockSendSummaryToDiscord: vi.fn(),
  mockSendDiscordSummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/summaryService", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/summaryService")>(
    "../../../lib/summaryService",
  );
  return {
    SummaryError: actual.SummaryError,
    generateUnreadSummary: mockGenerateUnreadSummary,
    sendSummaryToDiscord: mockSendSummaryToDiscord,
  };
});

vi.mock("../../../lib/discord", () => ({ sendDiscordSummary: mockSendDiscordSummary }));

import { POST as generatePost } from "../../../pages/api/summaries/generate";
import { POST as sendPost } from "../../../pages/api/summaries/send-discord";
import { SummaryError } from "../../../lib/summaryService";

function makeContext(body?: unknown, rawBody?: string) {
  const request = new Request("http://localhost/api/summaries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  return { request } as never;
}

const okResult = {
  status: "ok" as const,
  summaryText: "AI 摘要內容",
  emailCount: 4,
  periodStart: new Date("2026-01-01T00:00:00Z"),
  periodEnd: new Date("2026-01-01T12:00:00Z"),
};

describe("POST /api/summaries/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateUnreadSummary.mockResolvedValue(okResult);
  });

  it("應以 force 模式產生摘要並回傳摘要內容", async () => {
    const res = await generatePost(makeContext({}));
    expect(res.status).toBe(200);
    expect(mockGenerateUnreadSummary).toHaveBeenCalledWith({ force: true });
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", emailCount: 4, summaryText: "AI 摘要內容", discordSent: false });
  });

  it("force 明確為 false 時應保留排程的重複檢查", async () => {
    await generatePost(makeContext({ force: false }));
    expect(mockGenerateUnreadSummary).toHaveBeenCalledWith({ force: false });
  });

  it("空 body 也應可正常執行", async () => {
    const res = await generatePost(makeContext());
    expect(res.status).toBe(200);
  });

  it("sendDiscord 為 true 時應同時推送 Discord", async () => {
    const res = await generatePost(makeContext({ sendDiscord: true }));
    expect(mockSendDiscordSummary).toHaveBeenCalledWith(expect.objectContaining({ manual: true }));
    const body = await res.json();
    expect(body.discordSent).toBe(true);
  });

  it("Discord 推送失敗不應影響摘要產生結果", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSendDiscordSummary.mockRejectedValueOnce(new Error("Discord error"));
    const res = await generatePost(makeContext({ sendDiscord: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.discordSent).toBe(false);
    consoleSpy.mockRestore();
  });

  it("無未讀郵件時應回傳 skipped", async () => {
    mockGenerateUnreadSummary.mockResolvedValueOnce({ status: "skipped", reason: "no unread emails" });
    const res = await generatePost(makeContext({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "skipped", reason: "no unread emails" });
  });

  it("JSON 格式錯誤時應回傳 400", async () => {
    const res = await generatePost(makeContext(undefined, "{not json"));
    expect(res.status).toBe(400);
  });

  it("Gemini 失敗時應回傳 502", async () => {
    mockGenerateUnreadSummary.mockRejectedValueOnce(new SummaryError("Gemini summarization failed", "gemini"));
    const res = await generatePost(makeContext({}));
    expect(res.status).toBe(502);
  });

  it("其他錯誤時應回傳 500", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGenerateUnreadSummary.mockRejectedValueOnce(new Error("boom"));
    const res = await generatePost(makeContext({}));
    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });
});

describe("POST /api/summaries/send-discord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendSummaryToDiscord.mockResolvedValue({
      summaryText: "AI 摘要內容",
      emailCount: 4,
      periodStart: new Date(),
      periodEnd: new Date(),
    });
  });

  it("未指定 id 時應發送最新摘要", async () => {
    const res = await sendPost(makeContext({}));
    expect(res.status).toBe(200);
    expect(mockSendSummaryToDiscord).toHaveBeenCalledWith(undefined);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", emailCount: 4 });
  });

  it("指定 summaryId 時應轉交給 service", async () => {
    await sendPost(makeContext({ summaryId: "s1" }));
    expect(mockSendSummaryToDiscord).toHaveBeenCalledWith("s1");
  });

  it("找不到摘要時應回傳 404", async () => {
    mockSendSummaryToDiscord.mockRejectedValueOnce(new SummaryError("Summary not found", "db"));
    const res = await sendPost(makeContext({ summaryId: "missing" }));
    expect(res.status).toBe(404);
  });

  it("未設定 webhook 時應回傳 500 與錯誤訊息", async () => {
    mockSendSummaryToDiscord.mockRejectedValueOnce(
      new SummaryError("DISCORD_WEBHOOK_URL is not configured", "db"),
    );
    const res = await sendPost(makeContext({}));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("DISCORD_WEBHOOK_URL");
  });

  it("Discord 發送失敗時應回傳 502", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSendSummaryToDiscord.mockRejectedValueOnce(new Error("Discord webhook failed (500)"));
    const res = await sendPost(makeContext({}));
    expect(res.status).toBe(502);
    consoleSpy.mockRestore();
  });

  it("JSON 格式錯誤時應回傳 400", async () => {
    const res = await sendPost(makeContext(undefined, "{not json"));
    expect(res.status).toBe(400);
  });
});
