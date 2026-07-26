const TIMEZONE = "Asia/Taipei";

function dateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatEmailDate(receivedAt: string): string {
  const date = new Date(receivedAt);
  const isToday = dateKey(date) === dateKey(new Date());

  if (isToday) {
    return date.toLocaleTimeString("zh-TW", {
      timeZone: TIMEZONE,
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString("zh-TW", {
    timeZone: TIMEZONE,
    month: "short",
    day: "numeric",
  });
}
