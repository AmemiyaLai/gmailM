import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildCleanupResultEmbed,
  buildCleanupReviewEmbed,
  editInteractionMessage,
  sendCleanupReview,
} from "../lib/discord";

/**
 * 關鍵字清理的 Discord 訊息組裝與送出。
 * 這部分走 Bot API（不是 webhook），因為 webhook 訊息無法攜帶按鈕 components。
 */

const emails = [
  { id: "m1", sender: "「經濟日報會員報」 <mailman@mx.udnpaper.com>", subject: "每日會員報", keyword: "udnpaper.com" },
  { id: "m2", sender: "「蝦皮購物」 <info@mail.shopee.tw>", subject: "訂單即將撥款賣家", keyword: "即將撥款賣家" },
];

describe("buildCleanupReviewEmbed()", () => {
  beforeEach(() => {
    vi.stubEnv("SITE_URL", "https://mail.example.com");
  });

  it("trash 與 read 應使用不同標題、顏色與 footer", () => {
    const trash = buildCleanupReviewEmbed({ reviewId: "r1", action: "trash", emails });
    const read = buildCleanupReviewEmbed({ reviewId: "r2", action: "read", emails });

    expect(trash.title).toContain("刪除");
    expect(read.title).toContain("標記已讀");
    expect(trash.color).not.toBe(read.color);
    expect((trash.footer as { text: string }).text).toContain("垃圾桶");
    expect((read.footer as { text: string }).text).toContain("不會被刪除");
  });

  it("描述應列出每封郵件的主旨、寄件者與命中關鍵字", () => {
    const embed = buildCleanupReviewEmbed({ reviewId: "r1", action: "trash", emails });
    const description = embed.description as string;

    expect(description).toContain("以下 2 封郵件");
    expect(description).toContain("每日會員報");
    expect(description).toContain("udnpaper.com");
    expect(description).toContain("即將撥款賣家");
  });

  it("SITE_URL 未設定時不應產生管理頁面欄位", () => {
    vi.stubEnv("SITE_URL", "");
    const embed = buildCleanupReviewEmbed({ reviewId: "r1", action: "trash", emails });
    expect(embed.fields).toEqual([]);
  });

  it("過長的主旨與寄件者應被裁切，避免超出 Discord 長度限制", () => {
    const embed = buildCleanupReviewEmbed({
      reviewId: "r1",
      action: "trash",
      emails: [{ id: "m1", sender: "x".repeat(200), subject: "y".repeat(200), keyword: "k" }],
    });
    const description = embed.description as string;

    expect(description).toContain("…");
    expect(description).not.toContain("y".repeat(100));
  });

  it("主旨或寄件者為空字串時應顯示替代文字", () => {
    const embed = buildCleanupReviewEmbed({
      reviewId: "r1",
      action: "trash",
      emails: [{ id: "m1", sender: "", subject: "", keyword: "k" }],
    });
    const description = embed.description as string;

    expect(description).toContain("(無主旨)");
    expect(description).toContain("(未知)");
  });
});

describe("sendCleanupReview()", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    vi.stubEnv("DISCORD_CLEANUP_CHANNEL_ID", "channel-1");
    vi.stubEnv("SITE_URL", "https://mail.example.com");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("應以 Bot 身分 POST 到頻道並附上兩顆按鈕", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "discord-msg-1" }) });

    const id = await sendCleanupReview({ reviewId: "r1", action: "trash", emails });

    expect(id).toBe("discord-msg-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/v10/channels/channel-1/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bot bot-token");

    const body = JSON.parse(init.body as string);
    const row = body.components[0];
    expect(row.type).toBe(1);
    expect(row.components).toHaveLength(2);
    expect(row.components[0]).toMatchObject({ label: "✅ 確認刪除", custom_id: "cleanup:approve:r1" });
    expect(row.components[1]).toMatchObject({ label: "❌ 取消", custom_id: "cleanup:reject:r1" });
  });

  it("read 動作的確認按鈕文案應是標記已讀", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "discord-msg-2" }) });

    await sendCleanupReview({ reviewId: "r2", action: "read", emails });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.components[0].components[0]).toMatchObject({
      label: "✅ 標記已讀",
      custom_id: "cleanup:approve:r2",
    });
  });

  it("未設定 Bot token 或頻道時應丟出錯誤且不發請求", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    await expect(sendCleanupReview({ reviewId: "r1", action: "trash", emails })).rejects.toThrow(
      /DISCORD_BOT_TOKEN/,
    );

    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    vi.stubEnv("DISCORD_CLEANUP_CHANNEL_ID", "");
    await expect(sendCleanupReview({ reviewId: "r1", action: "trash", emails })).rejects.toThrow(
      /DISCORD_CLEANUP_CHANNEL_ID/,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Discord 回非 2xx 時應帶上狀態碼與回應內容丟錯", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => "Missing Permissions" });

    await expect(sendCleanupReview({ reviewId: "r1", action: "trash", emails })).rejects.toThrow(
      /403.*Missing Permissions/,
    );
  });

  it("錯誤回應的 body 讀取失敗時仍應丟出含狀態碼的錯誤", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => { throw new Error("boom"); } });

    await expect(sendCleanupReview({ reviewId: "r1", action: "trash", emails })).rejects.toThrow(/500/);
  });

  it("回應不是合法 JSON 時應回傳 null 而非丟錯", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new Error("not json"); } });

    await expect(sendCleanupReview({ reviewId: "r1", action: "trash", emails })).resolves.toBeNull();
  });

  it("回應沒有 id 欄位時應回傳 null", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await expect(sendCleanupReview({ reviewId: "r1", action: "trash", emails })).resolves.toBeNull();
  });
});

describe("editInteractionMessage()", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const embed = { title: "t", description: "d" };

  it("應 PATCH 原始互動訊息並清空按鈕", async () => {
    fetchMock.mockResolvedValue({ ok: true });

    await editInteractionMessage("app-1", "token-1", embed);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/v10/webhooks/app-1/token-1/messages/@original");
    expect(init.method).toBe("PATCH");
    // interaction token 本身即憑證，不該帶 Bot token
    expect(init.headers.Authorization).toBeUndefined();

    const body = JSON.parse(init.body as string);
    expect(body.embeds).toEqual([embed]);
    expect(body.components).toEqual([]);
  });

  it("Discord 回非 2xx 時應丟出含狀態碼的錯誤", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => "Unknown Webhook" });

    await expect(editInteractionMessage("app-1", "token-1", embed)).rejects.toThrow(
      /404.*Unknown Webhook/,
    );
  });

  it("錯誤回應讀取失敗時仍應丟出含狀態碼的錯誤", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => { throw new Error("boom"); } });

    await expect(editInteractionMessage("app-1", "token-1", embed)).rejects.toThrow(/500/);
  });
});

describe("buildCleanupResultEmbed()", () => {
  it("trash 通過時應說明已移至垃圾桶", () => {
    const embed = buildCleanupResultEmbed("trash", "approved", { processedCount: 3, failedCount: 0 });
    expect(embed.description).toContain("3 封");
    expect(embed.description).toContain("移至垃圾桶");
    expect(embed.description).not.toContain("處理失敗");
  });

  it("read 通過時應說明已標記為已讀", () => {
    const embed = buildCleanupResultEmbed("read", "approved", { processedCount: 5, failedCount: 0 });
    expect(embed.description).toContain("5 封");
    expect(embed.description).toContain("標記為已讀");
  });

  it("有失敗封數時應附上警告並改用警示色", () => {
    const ok = buildCleanupResultEmbed("trash", "approved", { processedCount: 1, failedCount: 0 });
    const partial = buildCleanupResultEmbed("trash", "approved", { processedCount: 1, failedCount: 2 });

    expect(partial.description).toContain("有 2 封處理失敗");
    expect(partial.color).not.toBe(ok.color);
  });

  it("缺少數量欄位時應以 0 呈現", () => {
    const embed = buildCleanupResultEmbed("trash", "approved");
    expect(embed.description).toContain("0 封");
  });

  it("取消時應說明郵件保持原狀", () => {
    const embed = buildCleanupResultEmbed("read", "rejected", { emailCount: 4 });
    expect(embed.description).toContain("已取消");
    expect(embed.description).toContain("4 封");

    expect(buildCleanupResultEmbed("read", "rejected").description).toContain("0 封");
  });

  it("已處理過時應顯示提醒文字", () => {
    const embed = buildCleanupResultEmbed("trash", "already-handled");
    expect(embed.description).toContain("已經處理過");
  });
});
