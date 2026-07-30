/**
 * Gmail push 通知的 payload 解析。
 *
 * GCP Pub/Sub 的標準 push 格式會把實際內容包成 base64 放在 `message.data`：
 *   { message: { data: "<base64>", messageId, publishTime }, subscription }
 * 解出來才是 Gmail 的 `{ emailAddress, historyId }`。
 */

export interface GmailNotification {
  emailAddress: string;
  historyId: string;
}

export interface PubSubPushBody {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
  };
  subscription?: string;
  // 未包裝格式（手動 curl 重放時方便使用）
  emailAddress?: string;
  historyId?: string | number;
}

function toNotification(value: unknown): GmailNotification | null {
  if (!value || typeof value !== "object") return null;
  const { emailAddress, historyId } = value as Record<string, unknown>;
  if (typeof emailAddress !== "string" || emailAddress === "") return null;
  if (historyId == null || historyId === "") return null;
  return { emailAddress, historyId: String(historyId) };
}

/**
 * 解析 Gmail push 通知，支援標準 Pub/Sub envelope 與未包裝的扁平格式。
 * 回傳 null 代表 payload 無效。
 */
export function parseGmailNotification(body: PubSubPushBody | null | undefined): GmailNotification | null {
  // 標準 Pub/Sub envelope 優先，避免與頂層欄位混淆
  const data = body?.message?.data;
  if (typeof data === "string" && data !== "") {
    try {
      // 注意是標準 base64（含 +/=），不是 gmail.ts 內文用的 base64url
      return toNotification(JSON.parse(Buffer.from(data, "base64").toString("utf-8")));
    } catch {
      return null;
    }
  }

  // 未包裝格式：保留給手動重放某個 historyId 的除錯情境
  return toNotification(body);
}
