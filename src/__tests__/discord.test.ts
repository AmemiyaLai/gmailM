import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { sendDiscordNotification, sendDiscordSummary, sendFirstSenderDigestNotification, buildCleanupReviewEmbed, buildCleanupResultEmbed, sendCleanupReview } from "../lib/discord";

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

  it("SITE_URL 為空時 embeds 不應包含管理頁面欄位", async () => {
    vi.stubEnv("SITE_URL", "");
    const email = {
      threadId: "thread-7",
      sender: "x@example.com",
      subject: "Hi",
      snippet: "",
      receivedAt: new Date(),
      category: "system",
      labels: [],
    };

    await sendDiscordNotification(email);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const managementField = body.embeds[0].fields.find(
      (f: { name: string }) => f.name === "管理頁面",
    );
    expect(managementField).toBeUndefined();
  });

  it("未知分類的 categoryBadge 為 null 時應顯示 未分類", async () => {
    const email = {
      threadId: "thread-8",
      sender: "x@example.com",
      subject: "Test",
      snippet: "",
      receivedAt: new Date(),
      category: "unknown_category",
      labels: [],
    };
    await sendDiscordNotification(email);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const categoryField = body.embeds[0].fields.find(
      (f: { name: string }) => f.name === "分類",
    );
    expect(categoryField.value).toBe("未分類");
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

  it("SITE_URL 為空時 url 應為 undefined", async () => {
    vi.stubEnv("SITE_URL", "");
    const summary = {
      summaryText: "s",
      emailCount: 0,
      periodStart: new Date(),
      periodEnd: new Date(),
    };

    await sendDiscordSummary(summary);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.embeds[0].url).toBeUndefined();
  });

  it("Discord 回傳錯誤 status 時應拋出例外", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const summary = {
      summaryText: "s",
      emailCount: 1,
      periodStart: new Date(),
      periodEnd: new Date(),
    };

    await expect(sendDiscordSummary(summary)).rejects.toThrow("Discord webhook failed (500)");
  });

  it("manual 為 true 時標題應標示手動發送", async () => {
    const summary = {
      summaryText: "手動摘要",
      emailCount: 3,
      periodStart: new Date(),
      periodEnd: new Date(),
      manual: true,
    };
    await sendDiscordSummary(summary);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.embeds[0].title).toContain("手動");
  });
});

describe("buildCleanupReviewEmbed()", () => {
  beforeEach(() => {
    vi.stubEnv("SITE_URL", "https://gmail-monitor.vercel.app");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("應回傳正確的 embed 結構", () => {
    const payload = {
      reviewId: "review-1",
      action: "trash" as const,
      emails: [
        { id: "m1", sender: "a@x.com", subject: "優惠一", keyword: "優惠" },
        { id: "m2", sender: "b@x.com", subject: "長標題" + "x".repeat(100), keyword: "測試" },
      ],
    };

    const embed = buildCleanupReviewEmbed(payload);

    expect(embed.title).toContain("刪除");
    expect(embed.color).toBe(0xf97316);
    expect(embed.description).toContain("2 封");
    expect(embed.description).toContain("優惠一");
    expect(embed.fields).toHaveLength(1);
    expect((embed.fields as Array<{ name: string; value: string }>)[0].name).toBe("關鍵字設定");
    expect(embed.footer).toBeDefined();
    expect((embed.footer as { text: string }).text).toContain("垃圾桶");
  });

  it("action 為 read 時應使用對應文案與顏色", () => {
    const payload = {
      reviewId: "review-2",
      action: "read" as const,
      emails: [{ id: "m1", sender: "a@x.com", subject: "通知信", keyword: "通知" }],
    };

    const embed = buildCleanupReviewEmbed(payload);

    expect(embed.title).toContain("標記已讀");
    expect(embed.color).toBe(0x5865f2);
    expect((embed.footer as { text: string }).text).toContain("已讀");
  });

  it("SITE_URL 為空時不應包含關鍵字設定欄位", () => {
    vi.stubEnv("SITE_URL", "");
    const payload = {
      reviewId: "review-3",
      action: "trash" as const,
      emails: [],
    };

    const embed = buildCleanupReviewEmbed(payload);
    expect(embed.fields).toEqual([]);
  });

  it("主旨過長時應被 truncate", () => {
    const longSubject = "A".repeat(100);
    const payload = {
      reviewId: "review-4",
      action: "trash" as const,
      emails: [{ id: "m1", sender: "a@x.com", subject: longSubject, keyword: "測試" }],
    };

    const embed = buildCleanupReviewEmbed(payload);
    expect(embed.description).toContain("…");
  });
});

describe("buildCleanupResultEmbed()", () => {
  it("approved 狀態應包含已處理數量與正確顏色", () => {
    const embed = buildCleanupResultEmbed("trash", "approved", { processedCount: 3, failedCount: 0 });
    expect(embed.description).toContain("3 封");
    expect(embed.description).toContain("垃圾桶");
    expect(embed.color).toBe(0x57f287);
  });

  it("approved 且有失敗時應顯示警告", () => {
    const embed = buildCleanupResultEmbed("trash", "approved", { processedCount: 2, failedCount: 1 });
    expect(embed.description).toContain("1 封處理失敗");
    expect(embed.color).toBe(0xf97316);
  });

  it("rejected 狀態應顯示已取消與數量", () => {
    const embed = buildCleanupResultEmbed("trash", "rejected", { emailCount: 5 });
    expect(embed.description).toContain("已取消");
    expect(embed.description).toContain("5 封");
    expect(embed.color).toBe(0x99aab5);
  });

  it("already-handled 狀態應顯示已處理過", () => {
    const embed = buildCleanupResultEmbed("read", "already-handled");
    expect(embed.description).toContain("已經處理過");
    expect(embed.color).toBe(0x99aab5);
  });
});

describe("sendCleanupReview()", () => {
  beforeEach(() => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-123");
    vi.stubEnv("DISCORD_CLEANUP_CHANNEL_ID", "channel-456");
    vi.stubEnv("SITE_URL", "https://gmail-monitor.vercel.app");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "discord-msg-1" }) });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("應成功送出審核訊息並回傳 message id", async () => {
    const result = await sendCleanupReview({
      reviewId: "review-1",
      action: "trash",
      emails: [{ id: "m1", sender: "a@x.com", subject: "測試", keyword: "優惠" }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = fetchMock.mock.calls[0][0];
    expect(callUrl).toContain("channels/channel-456/messages");
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.headers.Authorization).toBe("Bot bot-token-123");
    expect(result).toBe("discord-msg-1");
  });

  it("Discord 回傳無 id 時應回傳 null", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    const result = await sendCleanupReview({
      reviewId: "review-2",
      action: "read",
      emails: [],
    });

    expect(result).toBeNull();
  });

  it("Discord 回傳錯誤時應拋出例外", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => "Forbidden" });

    await expect(sendCleanupReview({
      reviewId: "review-3",
      action: "trash",
      emails: [],
    })).rejects.toThrow("Discord 送出清理審核失敗 (403)");
  });

  it("缺少 BOT_TOKEN 或 CHANNEL_ID 時應拋出例外", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    vi.stubEnv("DISCORD_CLEANUP_CHANNEL_ID", "");

    await expect(sendCleanupReview({
      reviewId: "review-4",
      action: "trash",
      emails: [],
    })).rejects.toThrow("未設定");
  });
});

describe("sendFirstSenderDigestNotification()", () => {
  const entry = (i: number) => ({
    senderAddress: `sender${i}@example.com`,
    senderDisplay: `Sender ${i} <sender${i}@example.com>`,
    firstReceivedAt: "2026-07-26T08:00:00.000Z",
  });

  beforeEach(() => {
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc");
    vi.stubEnv("SITE_URL", "https://gmail-monitor.vercel.app");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 204 });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("應發送含人數、寄件者清單與管理頁面連結的摘要", async () => {
    await sendFirstSenderDigestNotification([entry(1), entry(2)]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.embeds[0].title).toBe("🛡️ 首次寄件者摘要");
    expect(body.embeds[0].description).toContain("**2** 位首次寄件者");
    expect(body.embeds[0].description).toContain("sender1@example.com");
    expect(body.embeds[0].description).toContain("sender2@example.com");
    expect(body.embeds[0].fields.find((f: { name: string }) => f.name === "管理頁面").value)
      .toContain("https://gmail-monitor.vercel.app/first-senders");
  });

  it("不得包含信件主旨或摘要內容（只列寄件者資訊）", async () => {
    await sendFirstSenderDigestNotification([entry(1)]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const fieldNames = body.embeds[0].fields.map((f: { name: string }) => f.name);
    expect(fieldNames).not.toContain("摘要");
    expect(fieldNames).not.toContain("緊急狀況");
    expect(body.embeds[0].url).toBeUndefined();
  });

  it("超過 15 位時應截斷清單並顯示剩餘人數", async () => {
    const entries = Array.from({ length: 18 }, (_, i) => entry(i));
    await sendFirstSenderDigestNotification(entries);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.embeds[0].description).toContain("**18** 位首次寄件者");
    expect(body.embeds[0].description).toContain("還有 3 位");
    expect(body.embeds[0].description).not.toContain("sender17@example.com");
  });

  it("空清單不應發送任何訊息", async () => {
    await sendFirstSenderDigestNotification([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("senderDisplay 為空時應以地址顯示；SITE_URL 為空時不含管理頁面欄位", async () => {
    vi.stubEnv("SITE_URL", "");
    await sendFirstSenderDigestNotification([
      { senderAddress: "empty@example.com", senderDisplay: "", firstReceivedAt: "2026-07-26T08:00:00.000Z" },
    ]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.embeds[0].description).toContain("empty@example.com");
    expect(body.embeds[0].fields.find((f: { name: string }) => f.name === "管理頁面")).toBeUndefined();
  });

  it("Discord 回傳錯誤時應拋出例外", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(sendFirstSenderDigestNotification([entry(1)])).rejects.toThrow("Discord webhook failed (500)");
  });

  it("未設定 DISCORD_WEBHOOK_URL 時應拋出例外", async () => {
    vi.stubEnv("DISCORD_WEBHOOK_URL", "");
    await expect(sendFirstSenderDigestNotification([entry(1)])).rejects.toThrow("DISCORD_WEBHOOK_URL");
  });
});

