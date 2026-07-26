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

  await fetch(webhookUrl, {
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
          ],
          timestamp: email.receivedAt.toISOString(),
        },
      ],
    }),
  });
}
