import type { APIRoute } from "astro";
import { getSupabase } from "../../../lib/supabase";
import { MAX_PAYLOAD_BYTES, parseInboundPayload } from "../../../lib/inboundEmail";
import {
  ensureAlias,
  findDuplicateInboundEmail,
  saveInboundEmail,
  uploadInboundAttachments,
  type AttachmentMeta,
} from "../../../lib/inboundEmailService";

const DEFAULT_DOMAIN = "autodesignlab.org";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const authHeader = request.headers.get("authorization");
  const secret = import.meta.env.INBOUND_EMAIL_WEBHOOK_SECRET;

  // secret 未設定時一律拒絕，避免部署遺漏變成無防護的公開寫入端點
  if (!secret || !authHeader || authHeader !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return json(413, { error: "payload 超過大小上限" });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: "無效的 JSON" });
  }

  const domain = import.meta.env.INBOUND_EMAIL_DOMAIN || DEFAULT_DOMAIN;
  const parsed = parseInboundPayload(payload, domain);
  if (!parsed.ok) {
    return json(400, { error: parsed.error });
  }
  const email = parsed.email;

  const supabase = getSupabase();

  try {
    // 先查重再上傳附件，避免重試時在 Storage 留下孤兒檔案
    const existingId = await findDuplicateInboundEmail(supabase, email.messageId);
    if (existingId) {
      return json(200, { status: "ok", id: existingId, duplicate: true });
    }

    await ensureAlias(supabase, email.alias, email.receivedAt);

    const id = crypto.randomUUID();
    const storage = (supabase as { storage?: { from: (bucket: string) => any } }).storage;
    const metas: AttachmentMeta[] =
      storage && email.attachments.length > 0
        ? await uploadInboundAttachments(storage, id, email.attachments)
        : email.attachments.map((attachment) => ({
            filename: attachment.filename,
            mime_type: attachment.mimeType,
            size: attachment.size,
            storage_path: null,
            dropped: true,
          }));

    const saved = await saveInboundEmail(supabase, id, email, metas);
    return json(200, { status: "ok", id: saved.id, duplicate: saved.duplicate });
  } catch (err) {
    console.error("站點收件 webhook 處理失敗:", err);
    // 回 500 讓 Cloudflare Worker 丟出例外，由上游 SMTP 重試
    return json(500, { error: "internal error" });
  }
};
