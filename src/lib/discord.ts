export interface DiscordNotifiableEmail {
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: Date;
}

export async function sendDiscordNotification(
  email: DiscordNotifiableEmail,
): Promise<void> {
  const webhookUrl = import.meta.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: "📌 重要郵件",
          description: email.subject || "(無主旨)",
          fields: [
            { name: "寄件者", value: email.sender || "(未知)" },
            { name: "摘要", value: email.snippet || "(無內容)" },
          ],
          timestamp: email.receivedAt.toISOString(),
          color: 0xfee75c,
        },
      ],
    }),
  });
}
