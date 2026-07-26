import { describe, it, expect, vi, beforeEach } from "vitest";

const generateContentMock = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

import { summarizeUnreadEmails, judgeEmailImportance } from "../lib/gemini";

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
