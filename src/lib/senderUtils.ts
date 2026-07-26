export function extractSenderName(sender: string): string {
  const match = sender.match(/^(.+?)\s*<.+>$/);
  if (match) return match[1].replace(/^["']|["']$/g, "");
  return sender;
}
