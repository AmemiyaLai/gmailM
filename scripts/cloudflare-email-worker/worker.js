import PostalMime from "postal-mime";

/**
 * Cloudflare Email Worker：接收 Email Routing 轉入的原始郵件，
 * 以 postal-mime 解析後 POST JSON 至 gmailM 的 inbound webhook。
 *
 * 邊緣端負責裁剪：>1MB 的附件只送 metadata（dropped），
 * 整體 JSON 壓在 3.5MB 以下，避開 Vercel ~4.5MB body 上限。
 */

const MAX_RAW_SIZE = 10 * 1024 * 1024; // 超過直接拒收
const MAX_ATTACHMENT_BYTES = 1_048_576; // 1MB（原始大小）
const MAX_BODY_CHARS = 500_000;
const MAX_JSON_BYTES = 3_500_000;

/** 只轉送這些感興趣的標頭，避免 payload 膨脹 */
const HEADERS_OF_INTEREST = [
  "reply-to",
  "return-path",
  "authentication-results",
  "received-spf",
  "list-unsubscribe",
];

function truncate(text, max) {
  if (typeof text !== "string") return null;
  return text.length > max ? text.slice(0, max) : text;
}

function toBase64(data) {
  if (data == null) return null;
  if (typeof data === "string") return btoa(unescape(encodeURIComponent(data)));
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function buildPayload(parsed, rcptTo) {
  const headers = {};
  for (const header of parsed.headers ?? []) {
    const key = header.key?.toLowerCase();
    if (key && HEADERS_OF_INTEREST.includes(key) && !(key in headers)) {
      headers[key] = String(header.value ?? "").slice(0, 2000);
    }
  }

  const attachments = (parsed.attachments ?? []).map((attachment) => {
    const size =
      attachment.content?.byteLength ??
      (typeof attachment.content === "string" ? attachment.content.length : 0);
    const dropped = size > MAX_ATTACHMENT_BYTES;
    return {
      filename: attachment.filename || "attachment",
      mimeType: attachment.mimeType || "application/octet-stream",
      size,
      contentBase64: dropped ? null : toBase64(attachment.content),
      dropped,
    };
  });

  // Email Routing 的實際收件地址（envelope），比 To 標頭可靠（BCC／轉寄時 To 可能沒有本網域地址）
  const to = [rcptTo, ...(parsed.to ?? []).map((entry) => entry.address).filter(Boolean)].filter(
    (address, index, list) => address && list.indexOf(address) === index,
  );

  return {
    messageId: parsed.messageId ?? null,
    from: {
      address: parsed.from?.address ?? "",
      name: parsed.from?.name ?? null,
    },
    to,
    subject: parsed.subject ?? null,
    date: parsed.date ?? null,
    text: truncate(parsed.text, MAX_BODY_CHARS),
    html: truncate(parsed.html, MAX_BODY_CHARS),
    headers,
    attachments,
  };
}

/** payload 超過 JSON 上限時，由大到小改丟附件內容（以 base64 後長度計） */
function shrinkToFit(payload, maxBytes) {
  let json = JSON.stringify(payload);
  if (json.length <= maxBytes) return json;

  const byBase64Size = [...payload.attachments]
    .filter((attachment) => attachment.contentBase64)
    .sort((a, b) => (b.contentBase64?.length ?? 0) - (a.contentBase64?.length ?? 0));

  for (const attachment of byBase64Size) {
    attachment.contentBase64 = null;
    attachment.dropped = true;
    json = JSON.stringify(payload);
    if (json.length <= maxBytes) return json;
  }

  // 附件全丟後仍超限（極端長內文）：再砍 HTML
  payload.html = null;
  return JSON.stringify(payload);
}

export default {
  async email(message, env, ctx) {
    if (message.rawSize > MAX_RAW_SIZE) {
      message.setReject("Message too large");
      return;
    }

    const parsed = await PostalMime.parse(message.raw);
    const payload = buildPayload(parsed, message.to);
    const body = shrinkToFit(payload, MAX_JSON_BYTES);

    const res = await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.WEBHOOK_SECRET}`,
        // 站台若啟用 Cloudflare Access，需另設 service token 並取消下兩行註解
        // "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,
        // "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,
      },
      body,
    });

    if (res.status >= 500) {
      // 丟出例外 → Cloudflare 回覆暫時性失敗，上游 SMTP 會重試
      throw new Error(`inbound webhook ${res.status}`);
    }
    if (!res.ok) {
      // 4xx 為永久性錯誤（驗證失敗／格式錯誤），吞掉並記 log，避免退信風暴
      console.error(`inbound webhook rejected: ${res.status}`, await res.text().catch(() => ""));
    }
  },
};
