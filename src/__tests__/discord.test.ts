import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { sendDiscordNotification, sendDiscordSummary, sendFirstSenderDiscordNotification } from "../lib/discord";

describe("sendDiscordNotification()", () => {
  beforeEach(() => {
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc");
    vi.stubEnv("SITE_URL", "https://gmail-monitor.vercel.app");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("應向 Discord webhook 發送 POST 請求", async () => {
    const email = {
      threadId: "thread-1",
      sender: "boss@example.com",
      subject: "緊急會議",
      snippet: "請立即參加",
      receivedAt: new Date("2026-07-26T08:00:00Z"),
      category: "system",
      labels: ["IMPORTANT"],
    };

    await sendDiscordNotification(email);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/123/abc",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("應包含正確的 embed 結構", async () => {
    const email = {
      threadId: "thread-2",
      sender: "alice@example.com",
      subject: "測試郵件",
      snippet: "摘要內容",
      receivedAt: new Date("2026-07-26T10:00:00Z"),
      category: "devlog",
      labels: [],
    };

    await sendDiscordNotification(email);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0].title).toBe("📌 重要郵件通知");
    expect(body.embeds[0].description).toBe("測試郵件");
    expect(body.embeds[0].url).toContain("thread-2");
  });

  it("subject 為空時應顯示 (無主旨)", async () => {
    const email = {
      threadId: "thread-3",
      sender: "bob@example.com",
      subject: "",
      snippet: "some snippet",
      receivedAt: new Date(),
      category: "uncategorized",
      labels: [],
    };

    await sendDiscordNotification(email);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.embeds[0].description).toBe("(無主旨)");
  });

  it("應在 fields 中包含寄件者", async () => {
    const email = {
      threadId: "thread-4",
      sender: "carol@example.com",
      subject: "Test",
      snippet: "",
      receivedAt: new Date(),
      category: "newsletter",
      labels: ["STARRED"],
    };

    await sendDiscordNotification(email);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const senderField = body.embeds[0].fields.find(
      (f: { name: string }) => f.name === "寄件者",
    );
    expect(senderField).toBeDefined();
    expect(senderField.value).toBe("carol@example.com");
  });

  it("IMPORTANT + STARRED labels 應產生正確的緊急標籤", async () => {
    const email = {
      threadId: "thread-5",
      sender: "x@example.com",
      subject: "Important",
      snippet: "",
      receivedAt: new Date(),
      category: "system",
      labels: ["IMPORTANT", "STARRED"],
    };

    await sendDiscordNotification(email);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const urgencyField = body.embeds[0].fields.find(
      (f: { name: string }) => f.name === "緊急狀況",
    );
    expect(urgencyField.value).toContain("重要");
    expect(urgencyField.value).toContain("加星號");
  });

  it("無特殊 labels 時緊急狀況應為 —", async () => {
    const email = {
      threadId: "thread-6",
      sender: "x@example.com",
      subject: "Hi",
      snippet: "",
      receivedAt: new Date(),
      category: "uncategorized",
      labels: [],
    };

    await sendDiscordNotification(email);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const urgencyField = body.embeds[0].fields.find(
      (f: { name: string }) => f.name === "緊急狀況",
    );
    expect(urgencyField.value).toBe("—");
  });

  it("DISCORD_WEBHOOK_URL 為空時應直接返回不發送", async () => {
    vi.stubEnv("DISCORD_WEBHOOK_URL", "");
    const email = {
      threadId: "t",
      sender: "s",
      subject: "s",
      snippet: "n",
      receivedAt: new Date(),
      category: "system",
      labels: [],
    };

    await sendDiscordNotification(email);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendDiscordSummary()", () => {
  beforeEach(() => {
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc");
    vi.stubEnv("SITE_URL", "https://gmail-monitor.vercel.app");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("應向 Discord webhook 發送 POST 請求", async () => {
    const summary = {
      summaryText: "今日有 5 封未讀郵件",
      emailCount: 5,
      periodStart: new Date("2026-07-26T00:00:00Z"),
      periodEnd: new Date("2026-07-26T23:59:59Z"),
    };

    await sendDiscordSummary(summary);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/123/abc",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("應包含正確的摘要 embed 結構", async () => {
    const summary = {
      summaryText: "重要的摘要文字",
      emailCount: 12,
      periodStart: new Date("2026-07-26T00:00:00Z"),
      periodEnd: new Date("2026-07-26T23:59:59Z"),
    };

    await sendDiscordSummary(summary);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.embeds[0].title).toBe("📬 每小時未讀郵件摘要");
    expect(body.embeds[0].description).toBe("重要的摘要文字");
    expect(body.embeds[0].fields.find((f: { name: string }) => f.name === "未讀郵件數").value).toBe("12");
  });

  it("DISCORD_WEBHOOK_URL 為空時應直接返回不發送", async () => {
    vi.stubEnv("DISCORD_WEBHOOK_URL", "");
    const summary = {
      summaryText: "s",
      emailCount: 0,
      periodStart: new Date(),
      periodEnd: new Date(),
    };

    await sendDiscordSummary(summary);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendFirstSenderDiscordNotification()", () => {
  beforeEach(() => {
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 204 });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("應發送含安全提示與正規化地址的首次寄件者通知", async () => {
    await sendFirstSenderDiscordNotification({
      threadId: "thread-1", sender: "Alice <alice@example.com>", senderAddress: "alice@example.com",
      subject: "帳號通知", snippet: "請確認", receivedAt: new Date("2026-07-26T08:00:00Z"),
      category: "system", labels: ["IMPORTANT"],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.embeds[0].title).toBe("🛡️ 首次寄件者安全提醒");
    expect(body.embeds[0].fields.find((f: { name: string }) => f.name === "正規化地址").value).toBe("alice@example.com");
    expect(body.embeds[0].fields.find((f: { name: string }) => f.name === "安全建議").value).toContain("勿直接開啟");
  });

  it("Discord 回傳錯誤時應拋出例外", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(sendFirstSenderDiscordNotification({
      threadId: "t", sender: "a@example.com", senderAddress: "a@example.com", subject: "", snippet: "",
      receivedAt: new Date(), category: "system", labels: [],
    })).rejects.toThrow("Discord webhook failed (500)");
  });
});
