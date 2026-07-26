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
  return google.gmail({ version: "v1", auth: oauth2Client });
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
}

export interface HistoryChange {
  messageId: string;
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
      historyTypes: ["messageAdded"],
    });

    historyId = res.data.historyId ?? startHistoryId;

    for (const record of res.data.history ?? []) {
      for (const msg of record.messagesAdded ?? []) {
        if (msg.message?.id) {
          messages.push({ messageId: msg.message.id });
        }
      }
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return { historyId, messages };
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
      labelIds: ["INBOX"],
    },
  });

  return {
    historyId: res.data.historyId ?? "",
    expiration: res.data.expiration ?? "",
  };
}
