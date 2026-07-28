import { describe, it, expect, vi, beforeEach } from "vitest";

const generateContentMock = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

import { summarizeUnreadEmails, judgeEmailImportance, judgeSenderTag } from "../lib/gemini";

describe("summarizeUnreadEmails()", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("應回傳 Gemini 產生的摘要文字", async () => {
    generateContentMock.mockResolvedValue({ text: "  這是摘要內容  " });

    const result = await summarizeUnreadEmails([
      {
        sender: "boss@example.com",
        subject: "請盡快回覆",
        snippet: "有急事",
        category: "uncategorized",
        receivedAt: new Date("2026-07-26T08:00:00Z"),
      },
    ]);

    expect(result).toBe("這是摘要內容");
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("Gemini 未回傳內容時應給予預設訊息", async () => {
    generateContentMock.mockResolvedValue({ text: undefined });

    const result = await summarizeUnreadEmails([
      {
        sender: "a@example.com",
        subject: "s",
        snippet: "n",
        category: null,
        receivedAt: new Date(),
      },
    ]);

    expect(result).toBe("(Gemini 未回傳摘要內容)");
  });

  it("Gemini API 失敗時應向外拋出錯誤", async () => {
    generateContentMock.mockRejectedValue(new Error("quota exceeded"));

    await expect(
      summarizeUnreadEmails([
        { sender: "a@example.com", subject: "s", snippet: "n", category: null, receivedAt: new Date() },
      ]),
    ).rejects.toThrow("quota exceeded");
  });
});

describe("judgeEmailImportance()", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("應正確解析重要郵件的 JSON 回應", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ important: true, reason: "帳務警示" }),
    });

    const result = await judgeEmailImportance({
      sender: "bank@example.com",
      subject: "帳戶異常",
      snippet: "請立即處理",
    });

    expect(result).toEqual({ important: true, reason: "帳務警示" });
  });

  it("應正確解析不重要郵件的 JSON 回應", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ important: false }),
    });

    const result = await judgeEmailImportance({
      sender: "newsletter@example.com",
      subject: "本週電子報",
      snippet: "最新消息",
    });

    expect(result.important).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it("JSON 解析失敗時應向外拋出錯誤（由呼叫端 fallback）", async () => {
    generateContentMock.mockResolvedValue({ text: "not valid json" });

    await expect(
      judgeEmailImportance({ sender: "a@example.com", subject: "s", snippet: "n" }),
    ).rejects.toThrow();
  });
});

describe("judgeSenderTag()", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("應正確解析有效標籤的 JSON 回應", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ tag: "banking", confidence: 0.92 }),
    });

    const result = await judgeSenderTag({
      sender: "esun@esun.com",
      subject: "帳戶通知",
      snippet: "您的帳戶",
    });

    expect(result).toEqual({ tag: "banking", confidence: 0.92 });
  });

  it("應解析 development 標籤", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ tag: "development", confidence: 0.88 }),
    });

    const result = await judgeSenderTag({
      sender: "ci@unknown.com",
      subject: "Build succeeded",
      snippet: "Pipeline passed",
    });

    expect(result.tag).toBe("development");
    expect(result.confidence).toBe(0.88);
  });

  it("Gemini 回傳無效 tag 時應回傳 other", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ tag: "invalid_tag", confidence: 0.5 }),
    });

    const result = await judgeSenderTag({
      sender: "x@y.com",
      subject: "s",
      snippet: "n",
    });

    expect(result.tag).toBe("invalid_tag");
  });

  it("Gemini 回傳非數字 confidence 時應回傳 0", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ tag: "media", confidence: "high" }),
    });

    const result = await judgeSenderTag({
      sender: "x@y.com",
      subject: "s",
      snippet: "n",
    });

    expect(result.tag).toBe("media");
    expect(result.confidence).toBe(0);
  });

  it("Gemini 回傳空物件時應回傳 other + 0", async () => {
    generateContentMock.mockResolvedValue({ text: "{}" });

    const result = await judgeSenderTag({
      sender: "x@y.com",
      subject: "s",
      snippet: "n",
    });

    expect(result.tag).toBe("other");
    expect(result.confidence).toBe(0);
  });

  it("Gemini API 失敗時應向外拋出錯誤", async () => {
    generateContentMock.mockRejectedValue(new Error("quota exceeded"));

    await expect(
      judgeSenderTag({ sender: "x@y.com", subject: "s", snippet: "n" }),
    ).rejects.toThrow("quota exceeded");
  });

  it("應使用 JSON responseMimeType 模式", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ tag: "commerce", confidence: 0.85 }),
    });

    await judgeSenderTag({
      sender: "shop@shopee.com",
      subject: "訂單",
      snippet: "已出貨",
    });

    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { responseMimeType: "application/json" },
      }),
    );
  });

  it("當 res.text 為 undefined 時應退回預設值 other + 0", async () => {
    generateContentMock.mockResolvedValue({ text: undefined });

    const result = await judgeSenderTag({
      sender: "x@y.com",
      subject: "s",
      snippet: "n",
    });

    expect(result.tag).toBe("other");
    expect(result.confidence).toBe(0);
  });
});

describe("judgeEmailImportance() - fallback branches", () => {
  it("當 res.text 為 undefined 時應退回 important=false, reason=undefined", async () => {
    generateContentMock.mockResolvedValue({ text: undefined });

    const result = await judgeEmailImportance({
      sender: "test@example.com",
      subject: "subject",
      snippet: "snippet",
    });

    expect(result.important).toBe(false);
    expect(result.reason).toBeUndefined();
  });
});

