import { categoryBadge } from "./categoryBadge";

export interface DiscordNotifiableEmail {
  threadId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: Date;
  category: string;
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
          color: CATEGORY_COLORS[email.category] ?? DEFAULT_COLOR,
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

export interface EmailSummaryPayload {
  summaryText: string;
  emailCount: number;
  periodStart: Date;
  periodEnd: Date;
}

const SUMMARY_COLOR = 0x57f287; // green — 與重要通知的紅色區隔

export async function sendDiscordSummary(summary: EmailSummaryPayload): Promise<void> {
  const webhookUrl = import.meta.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const siteUrl = import.meta.env.SITE_URL;

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: "📬 每小時未讀郵件摘要",
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
}
