import { google } from "googleapis";

function getOAuth2Client() {
  return new google.auth.OAuth2(
    import.meta.env.GMAIL_OAUTH_CLIENT_ID,
    import.meta.env.GMAIL_OAUTH_CLIENT_SECRET,
  );
}

function getGmailClient() {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: import.meta.env.GMAIL_OAUTH_REFRESH_TOKEN,
  });
  // Webhook/Pub/Sub 已有自己的節流策略；禁止 gaxios 再把單次 429 放大成多次請求。
  return google.gmail({ version: "v1", auth: oauth2Client, retry: false, timeout: 10_000 });
}

export interface GmailApiErrorInfo {
  status: number | null;
  rateLimited: boolean;
  historyExpired: boolean;
  retryAfter: Date | null;
  message: string;
}

export function classifyGmailApiError(error: unknown, now = new Date()): GmailApiErrorInfo {
  const candidate = (error && typeof error === "object" ? error : {}) as {
    code?: number; message?: string; response?: { status?: number; headers?: { get?: (name: string) => string | null } };
    cause?: { message?: string };
  };
  const status = candidate.response?.status ?? candidate.code ?? null;
  const message = candidate.cause?.message ?? candidate.message ?? String(error);
  const retryHeader = candidate.response?.headers?.get?.("retry-after");
  const dateMatch = message.match(/Retry after\s+([^\s]+(?:Z|[+-]\d\d:\d\d))/i);
  let retryAfter: Date | null = null;
  if (retryHeader) {
    const seconds = Number(retryHeader);
    retryAfter = Number.isFinite(seconds)
      ? new Date(now.getTime() + seconds * 1000)
      : new Date(retryHeader);
  } else if (dateMatch) {
    retryAfter = new Date(dateMatch[1]);
  }
  if (retryAfter && Number.isNaN(retryAfter.getTime())) retryAfter = null;
  return {
    status,
    rateLimited: status === 429,
    historyExpired: status === 404,
    retryAfter,
    message,
  };
}

export interface GmailMessage {
  id: string;
  threadId: string;
  sender: string;
  recipient: string;
  subject: string;
  snippet: string;
  bodyHtml: string;
  bodyPlain: string;
  labels: string[];
  receivedAt: Date;
  isRead: boolean;
  /** Authentication-Results 標頭原文；多筆以 "\n" 串接，無則為 ""。 */
  authenticationResults: string;
  /** Received-SPF 標頭原文；多筆以 "\n" 串接，無則為 ""。 */
  receivedSpf: string;
}

/** 回填用的輕量標頭結果，見 getMessageAuthHeaders()。 */
export interface GmailAuthHeaders {
  id: string;
  from: string;
  authenticationResults: string;
  receivedSpf: string;
}

type GmailHeader = { name?: string | null; value?: string | null };

/** 取出同名標頭的全部值並以 "\n" 串接（Authentication-Results 可能有多筆）。 */
function joinHeaders(headers: GmailHeader[], name: string): string {
  return headers
    .filter((h) => h.name?.toLowerCase() === name.toLowerCase())
    .map((h) => h.value ?? "")
    .filter(Boolean)
    .join("\n");
}

export interface HistoryChange {
  messageId: string;
  kind: "added" | "stateChanged" | "deleted";
  labelIds: string[];
}

export interface GmailMessageState {
  id: string;
  threadId: string;
  labels: string[];
  isRead: boolean;
}

export interface GmailUnreadInboxMessage {
  id: string;
  threadId: string;
}

export async function listHistory(
  startHistoryId: string,
): Promise<{ historyId: string; messages: HistoryChange[] }> {
  const gmail = getGmailClient();
  const messages: HistoryChange[] = [];
  let pageToken: string | undefined;
  let historyId = startHistoryId;

  do {
    const res = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      pageToken,
    });

    historyId = res.data.historyId ?? startHistoryId;

    for (const record of res.data.history ?? []) {
      for (const msg of record.messagesAdded ?? []) {
        if (msg.message?.id) {
          messages.push({ messageId: msg.message.id, kind: "added", labelIds: msg.message.labelIds ?? [] });
        }
      }
      for (const change of record.labelsAdded ?? []) {
        if (change.message?.id) {
          messages.push({
            messageId: change.message.id,
            kind: "stateChanged",
            labelIds: change.labelIds ?? [],
          });
        }
      }
      for (const change of record.labelsRemoved ?? []) {
        if (change.message?.id) {
          messages.push({
            messageId: change.message.id,
            kind: "stateChanged",
            labelIds: change.labelIds ?? [],
          });
        }
      }
      for (const msg of record.messagesDeleted ?? []) {
        if (msg.message?.id) {
          messages.push({ messageId: msg.message.id, kind: "deleted", labelIds: [] });
        }
      }
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  const priority = { stateChanged: 1, added: 2, deleted: 3 } as const;
  const deduplicated = new Map<string, HistoryChange>();
  for (const change of messages) {
    const previous = deduplicated.get(change.messageId);
    if (!previous || priority[change.kind] >= priority[previous.kind]) {
      deduplicated.set(change.messageId, change);
    }
  }

  return { historyId, messages: Array.from(deduplicated.values()) };
}

export async function getMessageState(messageId: string): Promise<GmailMessageState> {
  const gmail = getGmailClient();
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: [],
  });
  const labels = res.data.labelIds ?? [];
  return {
    id: res.data.id ?? messageId,
    threadId: res.data.threadId ?? "",
    labels,
    isRead: !labels.includes("UNREAD"),
  };
}

export async function getInboxUnreadCount(): Promise<number> {
  const gmail = getGmailClient();
  const res = await gmail.users.labels.get({ userId: "me", id: "INBOX" });
  return res.data.threadsUnread ?? 0;
}

export async function listUnreadInboxMessages(): Promise<GmailUnreadInboxMessage[]> {
  const gmail = getGmailClient();
  const messages: GmailUnreadInboxMessage[] = [];
  let pageToken: string | undefined;

  do {
    const res = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX", "UNREAD"],
      maxResults: 500,
      pageToken,
    });
    for (const message of res.data.messages ?? []) {
      if (message.id && message.threadId) {
        messages.push({ id: message.id, threadId: message.threadId });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return messages;
}

export function isHistoryIdExpired(error: unknown): boolean {
  return classifyGmailApiError(error).historyExpired;
}

export async function getMessage(
  messageId: string,
): Promise<GmailMessage> {
  const gmail = getGmailClient();
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const msg = res.data;
  const headers = msg.payload?.headers ?? [];

  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

  const sender = getHeader("From");
  const recipient = getHeader("To");
  const subject = getHeader("Subject");
  const date = getHeader("Date");

  let bodyHtml = "";
  let bodyPlain = "";

  function extractBody(part: typeof msg.payload) {
    if (!part) return;
    if (part.mimeType === "text/html" && part.body?.data) {
      bodyHtml = Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    if (part.mimeType === "text/plain" && part.body?.data) {
      bodyPlain = Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    for (const child of part.parts ?? []) {
      extractBody(child);
    }
  }

  extractBody(msg.payload);

  return {
    id: msg.id!,
    threadId: msg.threadId!,
    sender,
    recipient,
    subject,
    snippet: msg.snippet ?? "",
    bodyHtml,
    bodyPlain,
    labels: msg.labelIds ?? [],
    receivedAt: date ? new Date(date) : new Date(),
    isRead: !(msg.labelIds ?? []).includes("UNREAD"),
    authenticationResults: joinHeaders(headers, "Authentication-Results"),
    receivedSpf: joinHeaders(headers, "Received-SPF"),
  };
}

/**
 * 只取驗證標頭的輕量查詢，供回填使用。
 * 與 format:"full" 同為 5 quota units，但回應體積小一到兩個數量級。
 */
export async function getMessageAuthHeaders(messageId: string): Promise<GmailAuthHeaders> {
  const gmail = getGmailClient();
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["Authentication-Results", "Received-SPF", "From"],
  });

  const headers = res.data.payload?.headers ?? [];
  return {
    id: res.data.id ?? messageId,
    from: joinHeaders(headers, "From"),
    authenticationResults: joinHeaders(headers, "Authentication-Results"),
    receivedSpf: joinHeaders(headers, "Received-SPF"),
  };
}

export async function listMessages(
  maxResults: number,
): Promise<string[]> {
  const gmail = getGmailClient();
  const ids: string[] = [];
  let pageToken: string | undefined;

  while (ids.length < maxResults) {
    const res = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX"],
      maxResults: Math.min(100, maxResults - ids.length),
      pageToken,
    });

    for (const msg of res.data.messages ?? []) {
      if (msg.id) ids.push(msg.id);
    }

    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  return ids;
}

export async function markAsRead(messageId: string): Promise<void> {
  const gmail = getGmailClient();
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      removeLabelIds: ["UNREAD"],
    },
  });
}

export async function markAsUnread(messageId: string): Promise<void> {
  const gmail = getGmailClient();
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: ["UNREAD"],
    },
  });
}

export async function setStarred(messageId: string, starred: boolean): Promise<void> {
  const gmail = getGmailClient();
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: starred
      ? { addLabelIds: ["STARRED"] }
      : { removeLabelIds: ["STARRED"] },
  });
}

export async function archiveMessage(messageId: string): Promise<void> {
  const gmail = getGmailClient();
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      removeLabelIds: ["INBOX"],
    },
  });
}

export async function trashMessage(messageId: string): Promise<void> {
  const gmail = getGmailClient();
  await gmail.users.messages.trash({
    userId: "me",
    id: messageId,
  });
}

export async function startWatch(): Promise<{
  historyId: string;
  expiration: string;
}> {
  const gmail = getGmailClient();
  const topicName = `projects/${import.meta.env.GCP_PROJECT_ID}/topics/${import.meta.env.PUBSUB_TOPIC}`;

  const res = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName,
    },
  });

  return {
    historyId: res.data.historyId ?? "",
    expiration: res.data.expiration ?? "",
  };
}
