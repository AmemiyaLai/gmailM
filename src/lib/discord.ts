import { categoryBadge } from "./categoryBadge";

export interface DiscordNotifiableEmail {
  threadId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: Date;
  // 未分類的郵件 category 會是 null，categoryBadge 本來就接受 null
  category: string | null;
  labels: string[];
}

export interface FirstSenderDiscordEmail extends DiscordNotifiableEmail {
  senderAddress: string;
}

const CATEGORY_COLORS: Record<string, number> = {
  devlog: 0x5865f2, // blurple
  newsletter: 0xeb459e, // pink
  system: 0xfee75c, // yellow
};
const DEFAULT_COLOR = 0xed4245; // red — 這支通知本身就只在「重要」郵件才會發送

function urgencyLabel(labels: string[]): string {
  const tags: string[] = [];
  if (labels.includes("IMPORTANT")) tags.push("🔴 重要");
  if (labels.includes("STARRED")) tags.push("⭐ 已加星號");
  return tags.length > 0 ? tags.join("、") : "—";
}

export async function sendDiscordNotification(
  email: DiscordNotifiableEmail,
): Promise<void> {
  const webhookUrl = import.meta.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const badge = categoryBadge(email.category);
  const siteUrl = import.meta.env.SITE_URL;

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: "📌 重要郵件通知",
          description: email.subject || "(無主旨)",
          url: `https://mail.google.com/mail/u/0/#all/${email.threadId}`,
          color: (email.category ? CATEGORY_COLORS[email.category] : undefined) ?? DEFAULT_COLOR,
          fields: [
            { name: "寄件者", value: email.sender || "(未知)" },
            { name: "分類", value: badge?.label ?? "未分類", inline: true },
            { name: "緊急狀況", value: urgencyLabel(email.labels), inline: true },
            { name: "摘要", value: email.snippet || "(無內容)" },
            ...(siteUrl ? [{ name: "管理頁面", value: `[前往查看](${siteUrl})` }] : []),
          ],
          timestamp: email.receivedAt.toISOString(),
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Discord webhook failed (${response.status})`);
}

export async function sendFirstSenderDiscordNotification(email: FirstSenderDiscordEmail): Promise<void> {
  const webhookUrl = import.meta.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("DISCORD_WEBHOOK_URL is not configured");

  const siteUrl = import.meta.env.SITE_URL;
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: "🛡️ 首次寄件者安全提醒",
        description: email.subject || "(無主旨)",
        url: `https://mail.google.com/mail/u/0/#all/${email.threadId}`,
        color: 0xf97316,
        fields: [
          { name: "寄件者", value: email.sender || "(未知)" },
          { name: "正規化地址", value: email.senderAddress },
          { name: "分類", value: categoryBadge(email.category)?.label ?? "未分類", inline: true },
          { name: "緊急狀況", value: urgencyLabel(email.labels), inline: true },
          { name: "摘要", value: email.snippet || "(無內容)" },
          { name: "安全建議", value: "此為首次寄件者，請透過獨立管道確認身分；勿直接開啟可疑連結或附件。" },
          ...(siteUrl ? [{ name: "管理頁面", value: `[前往查看](${siteUrl}/first-senders)` }] : []),
        ],
        timestamp: email.receivedAt.toISOString(),
      }],
    }),
  });
  if (!response.ok) throw new Error(`Discord webhook failed (${response.status})`);
}

const DISCORD_API = "https://discord.com/api/v10";
const CLEANUP_COLOR = 0xf97316; // 橘（trash）— 與首次寄件者提醒同屬「需要人確認」的訊息
const CLEANUP_READ_COLOR = 0x5865f2; // 藍（read）— 與 trash 區隔，非破壞性動作
const CLEANUP_DONE_COLOR = 0x57f287; // 綠
const CLEANUP_CANCELLED_COLOR = 0x99aab5; // 灰

type CleanupAction = "trash" | "read";

const CLEANUP_COPY: Record<CleanupAction, {
  title: string;
  color: number;
  footer: string;
  approveLabel: string;
  approvedVerb: string;
}> = {
  trash: {
    title: "🧹 關鍵字清理審核（刪除）",
    color: CLEANUP_COLOR,
    footer: "確認後將移至 Gmail 垃圾桶（30 天內可復原）",
    approveLabel: "✅ 確認刪除",
    approvedVerb: "移至垃圾桶",
  },
  read: {
    title: "📩 關鍵字清理審核（標記已讀）",
    color: CLEANUP_READ_COLOR,
    footer: "確認後將標記為已讀，郵件本身不會被刪除",
    approveLabel: "✅ 標記已讀",
    approvedVerb: "標記為已讀",
  },
};

export interface CleanupReviewEmail {
  id: string;
  sender: string;
  subject: string;
  keyword: string;
}

export interface CleanupReviewPayload {
  reviewId: string;
  action: CleanupAction;
  emails: CleanupReviewEmail[];
}

/** Discord embed 單一 field 上限 1024 字元，這裡保守裁切避免整則訊息被拒 */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function buildCleanupReviewEmbed(payload: CleanupReviewPayload): Record<string, unknown> {
  const siteUrl = import.meta.env.SITE_URL;
  const copy = CLEANUP_COPY[payload.action];
  const lines = payload.emails.map(
    (email, i) => `**${i + 1}.** ${truncate(email.subject || "(無主旨)", 80)}\n　└ ${truncate(email.sender || "(未知)", 60)}　🔑 \`${email.keyword}\``,
  );

  return {
    title: copy.title,
    description: truncate(
      `以下 ${payload.emails.length} 封郵件命中你設定的清理關鍵字：\n\n${lines.join("\n")}`,
      4000,
    ),
    color: copy.color,
    fields: siteUrl ? [{ name: "關鍵字設定", value: `[前往 /cleanup](${siteUrl}/cleanup)` }] : [],
    footer: { text: copy.footer },
    timestamp: new Date().toISOString(),
  };
}

function cleanupComponents(action: CleanupAction, reviewId: string): Record<string, unknown>[] {
  const copy = CLEANUP_COPY[action];
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 4, label: copy.approveLabel, custom_id: `cleanup:approve:${reviewId}` },
        { type: 2, style: 2, label: "❌ 取消", custom_id: `cleanup:reject:${reviewId}` },
      ],
    },
  ];
}

/**
 * 送出帶按鈕的清理審核訊息。
 * Webhook 訊息無法攜帶 components，故此處改用 Bot API（需 DISCORD_BOT_TOKEN）。
 * 回傳 Discord message id。
 */
export async function sendCleanupReview(payload: CleanupReviewPayload): Promise<string | null> {
  const token = import.meta.env.DISCORD_BOT_TOKEN;
  const channelId = import.meta.env.DISCORD_CLEANUP_CHANNEL_ID;
  if (!token || !channelId) {
    throw new Error("DISCORD_BOT_TOKEN 或 DISCORD_CLEANUP_CHANNEL_ID 未設定，無法送出清理審核訊息");
  }

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${token}`,
    },
    body: JSON.stringify({
      embeds: [buildCleanupReviewEmbed(payload)],
      components: cleanupComponents(payload.action, payload.reviewId),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord 送出清理審核失敗 (${res.status}) ${detail.slice(0, 200)}`);
  }

  const body = (await res.json().catch(() => null)) as { id?: string } | null;
  return body?.id ?? null;
}

/** 使用者按下按鈕後，用來就地覆寫原訊息的 embed（按鈕會一併移除） */
export function buildCleanupResultEmbed(
  action: CleanupAction,
  outcome: "approved" | "rejected" | "already-handled",
  detail: { processedCount?: number; failedCount?: number; emailCount?: number } = {},
): Record<string, unknown> {
  const copy = CLEANUP_COPY[action];

  if (outcome === "approved") {
    const failed = detail.failedCount ?? 0;
    return {
      title: copy.title,
      description:
        `✅ 已將 ${detail.processedCount ?? 0} 封郵件${copy.approvedVerb}。` +
        (failed > 0 ? `\n⚠️ 有 ${failed} 封處理失敗，請至 /cleanup 查看原因。` : ""),
      color: failed > 0 ? copy.color : CLEANUP_DONE_COLOR,
      timestamp: new Date().toISOString(),
    };
  }

  if (outcome === "rejected") {
    return {
      title: copy.title,
      description: `❌ 已取消，${detail.emailCount ?? 0} 封郵件保持原狀。`,
      color: CLEANUP_CANCELLED_COLOR,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    title: copy.title,
    description: "⚠️ 這則審核已經處理過了。",
    color: CLEANUP_CANCELLED_COLOR,
    timestamp: new Date().toISOString(),
  };
}

export interface EmailSummaryPayload {
  summaryText: string;
  emailCount: number;
  periodStart: Date;
  periodEnd: Date;
  /** 由使用者手動觸發時標示，與每小時排程的摘要區隔 */
  manual?: boolean;
}

const SUMMARY_COLOR = 0x57f287; // green — 與重要通知的紅色區隔

export async function sendDiscordSummary(summary: EmailSummaryPayload): Promise<void> {
  const webhookUrl = import.meta.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const siteUrl = import.meta.env.SITE_URL;

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: summary.manual ? "📬 未讀郵件摘要（手動發送）" : "📬 每小時未讀郵件摘要",
          description: summary.summaryText,
          url: siteUrl || undefined,
          color: SUMMARY_COLOR,
          fields: [
            { name: "未讀郵件數", value: String(summary.emailCount), inline: true },
            {
              name: "涵蓋期間",
              value: `${summary.periodStart.toLocaleString("zh-TW")} ～ ${summary.periodEnd.toLocaleString("zh-TW")}`,
              inline: true,
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Discord webhook failed (${res.status})`);
}

