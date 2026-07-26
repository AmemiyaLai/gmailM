export interface EmailFilterParams {
  q?: string;
  category?: string;
  sender?: string;
  recipient?: string;
  from?: string;
  to?: string;
  unread: boolean;
  important: boolean;
  page: number;
}

export function parseEmailFilterParams(url: URL): EmailFilterParams {
  const get = (key: string) => url.searchParams.get(key)?.trim() || undefined;
  return {
    q: get("q"),
    category: get("category"),
    sender: get("sender"),
    recipient: get("recipient"),
    from: get("from"),
    to: get("to"),
    unread: url.searchParams.get("unread") === "1",
    important: url.searchParams.get("important") === "1",
    page: Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1),
  };
}

export function buildFilterHref(basePath: string, params: Partial<EmailFilterParams>): string {
  const usp = new URLSearchParams();
  if (params.q) usp.set("q", params.q);
  if (params.category) usp.set("category", params.category);
  if (params.sender) usp.set("sender", params.sender);
  if (params.recipient) usp.set("recipient", params.recipient);
  if (params.from) usp.set("from", params.from);
  if (params.to) usp.set("to", params.to);
  if (params.unread) usp.set("unread", "1");
  if (params.important) usp.set("important", "1");
  if (params.page && params.page > 1) usp.set("page", String(params.page));
  const qs = usp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
