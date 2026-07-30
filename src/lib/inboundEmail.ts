import { createHash } from "node:crypto";
import { normalizeSenderAddress } from "./senderAddress";

/**
 * 自架站點收件匣的 payload 驗證與正規化（純函式，零 I/O）。
 * Cloudflare Email Worker 已在邊緣端解析 MIME 並裁剪附件，
 * 這裡負責 schema 檢查、別名抽取、冪等 id 與內文截斷。
 */

/** 附件原始大小上限（1MB），超過者只留 metadata */
export const MAX_ATTACHMENT_BYTES = 1_048_576;
/** 單封信最多保留內容的附件數，其餘僅留 metadata */
export const MAX_STORED_ATTACHMENTS = 10;
/** 內文（html / plain 各自）截斷長度 */
export const MAX_BODY_CHARS = 500_000;
/** webhook 路由的 Content-Length 上限，需低於 Vercel ~4.5MB body 限制 */
export const MAX_PAYLOAD_BYTES = 3_800_000;

const SNIPPET_MAX_CHARS = 200;
const ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_HEADER_VALUE_CHARS = 2_000;
const MAX_HEADER_COUNT = 30;

export interface InboundAttachmentPayload {
  filename: string;
  mimeType: string;
  size: number;
  /** dropped 時為 null */
  contentBase64: string | null;
  dropped: boolean;
}

export interface InboundEmailPayload {
  messageId: string | null;
  from: { address: string; name: string | null };
  to: string[];
  subject: string | null;
  date: string | null;
  text: string | null;
  html: string | null;
  headers: Record<string, string>;
  attachments: InboundAttachmentPayload[];
}

export interface NormalizedInboundEmail {
  messageId: string;
  alias: string;
  fromAddress: string;
  fromDisplay: string | null;
  toAddresses: string[];
  subject: string | null;
  snippet: string;
  bodyHtml: string | null;
  bodyPlain: string | null;
  headers: Record<string, string>;
  attachments: InboundAttachmentPayload[];
  receivedAt: string;
}

export type ParseInboundResult =
  | { ok: true; email: NormalizedInboundEmail }
  | { ok: false; error: string };

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** 從收件地址清單找出第一個屬於自架網域的別名（local part，小寫、去 +tag） */
export function extractAlias(to: string[], domain: string): string | null {
  const wanted = domain.trim().toLowerCase();
  if (!wanted) return null;

  for (const entry of to) {
    if (typeof entry !== "string") continue;
    const address = normalizeSenderAddress(entry);
    if (!address) continue;
    const [local, addressDomain] = address.split("@");
    if (addressDomain !== wanted) continue;
    const alias = local.split("+")[0];
    if (ALIAS_PATTERN.test(alias)) return alias;
  }
  return null;
}

/** 去標籤、壓空白後裁 200 字，供列表與 Discord 摘要顯示 */
export function makeSnippet(text: string | null, html: string | null): string {
  let source = text ?? "";
  if (!source.trim() && html) {
    source = html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  }
  const collapsed = source.replace(/\s+/g, " ").trim();
  return collapsed.length > SNIPPET_MAX_CHARS
    ? `${collapsed.slice(0, SNIPPET_MAX_CHARS - 1)}…`
    : collapsed;
}

/** Message-ID 缺漏時以內容雜湊產生確定性 id，讓上游重試仍能命中唯一索引 */
export function fallbackMessageId(payload: InboundEmailPayload): string {
  const hash = createHash("sha256")
    .update(payload.from.address)
    .update("\0")
    .update(payload.to.join(","))
    .update("\0")
    .update(payload.subject ?? "")
    .update("\0")
    .update(payload.date ?? "")
    .digest("hex");
  return `sha256:${hash}`;
}

export function truncateBody(body: string | null): { value: string | null; truncated: boolean } {
  if (body == null) return { value: null, truncated: false };
  if (body.length <= MAX_BODY_CHARS) return { value: body, truncated: false };
  return { value: body.slice(0, MAX_BODY_CHARS), truncated: true };
}

function normalizeHeaders(raw: unknown): Record<string, string> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    headers[key.toLowerCase()] = value.slice(0, MAX_HEADER_VALUE_CHARS);
    if (Object.keys(headers).length >= MAX_HEADER_COUNT) break;
  }
  return headers;
}

function normalizeAttachments(raw: unknown): InboundAttachmentPayload[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
    .map((item, index) => {
      const size = typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0;
      const contentBase64 = typeof item.contentBase64 === "string" ? item.contentBase64 : null;
      // Worker 端應已裁剪，這裡再守一次：超量、超大或缺內容者一律降為 metadata
      const dropped =
        item.dropped === true ||
        contentBase64 == null ||
        size > MAX_ATTACHMENT_BYTES ||
        index >= MAX_STORED_ATTACHMENTS;
      return {
        filename: asTrimmedString(item.filename) ?? `attachment-${index + 1}`,
        mimeType: asTrimmedString(item.mimeType) ?? "application/octet-stream",
        size,
        contentBase64: dropped ? null : contentBase64,
        dropped,
      };
    });
}

/** 驗證 Worker 送來的 JSON 並正規化為可落庫的結構 */
export function parseInboundPayload(json: unknown, domain: string): ParseInboundResult {
  if (json == null || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, error: "payload 必須是 JSON 物件" };
  }
  const body = json as Record<string, unknown>;

  const from = body.from as Record<string, unknown> | undefined;
  const fromAddress =
    from && typeof from === "object" ? normalizeSenderAddress(String(from.address ?? "")) : null;
  if (!fromAddress) {
    return { ok: false, error: "缺少有效的 from.address" };
  }

  if (!Array.isArray(body.to) || body.to.length === 0) {
    return { ok: false, error: "缺少收件人（to）" };
  }
  const toAddresses = body.to.filter((item): item is string => typeof item === "string");

  const alias = extractAlias(toAddresses, domain);
  if (!alias) {
    return { ok: false, error: `收件人不含 @${domain} 的有效別名` };
  }

  const payload: InboundEmailPayload = {
    messageId: asTrimmedString(body.messageId),
    from: { address: fromAddress, name: asTrimmedString(from?.name) },
    to: toAddresses,
    subject: asTrimmedString(body.subject),
    date: asTrimmedString(body.date),
    text: typeof body.text === "string" ? body.text : null,
    html: typeof body.html === "string" ? body.html : null,
    headers: normalizeHeaders(body.headers),
    attachments: normalizeAttachments(body.attachments),
  };

  const messageId = (payload.messageId ?? fallbackMessageId(payload)).slice(0, 255);

  const parsedDate = payload.date ? new Date(payload.date) : null;
  const receivedAt =
    parsedDate && !Number.isNaN(parsedDate.getTime())
      ? parsedDate.toISOString()
      : new Date().toISOString();

  return {
    ok: true,
    email: {
      messageId,
      alias,
      fromAddress,
      fromDisplay: payload.from.name,
      toAddresses,
      subject: payload.subject,
      snippet: makeSnippet(payload.text, payload.html),
      bodyHtml: truncateBody(payload.html).value,
      bodyPlain: truncateBody(payload.text).value,
      headers: payload.headers,
      attachments: payload.attachments,
      receivedAt,
    },
  };
}
