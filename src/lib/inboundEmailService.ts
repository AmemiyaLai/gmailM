import { Buffer } from "node:buffer";
import type { InboundAttachmentPayload, NormalizedInboundEmail } from "./inboundEmail";

/**
 * 自架站點收件匣的資料存取層。
 * 與 domainReputation.ts 相同，注入 SupabaseLike 而非直接 import getSupabase，方便測試。
 */

type SupabaseLike = { from: (table: string) => any };
type StorageLike = { from: (bucket: string) => any };

export const INBOUND_ATTACHMENT_BUCKET = "inbound-attachments";

const DUPLICATE_KEY_CODE = "23505";
const DIGEST_SCAN_LIMIT = 500;
const TOP_SENDER_COUNT = 5;
const NOTABLE_SUBJECT_COUNT = 5;

export interface InboundAliasRow {
  alias: string;
  label: string;
  site: string | null;
  note: string | null;
  color: string | null;
  is_active: boolean;
  message_count: number;
  last_received_at: string | null;
}

export interface InboundEmailRow {
  id: string;
  alias: string;
  from_address: string;
  from_display: string | null;
  subject: string | null;
  snippet: string | null;
  has_attachments: boolean;
  is_read: boolean;
  received_at: string;
}

export interface AttachmentMeta {
  filename: string;
  mime_type: string;
  size: number;
  storage_path: string | null;
  dropped: boolean;
}

export interface AliasPatch {
  label?: string;
  site?: string | null;
  note?: string | null;
  color?: string | null;
  is_active?: boolean;
}

export interface InboundDigestStats {
  total: number;
  unreadTotal: number;
  perAlias: { alias: string; label: string; count: number }[];
  topSenders: { fromAddress: string; count: number }[];
  notableSubjects: string[];
}

/** 別名不存在時自動建檔（label 預設「未分類」），並更新統計欄位。單一寫入者（webhook）下讀改寫安全。 */
export async function ensureAlias(supabase: SupabaseLike, alias: string, receivedAt: string): Promise<void> {
  const { data } = await supabase
    .from("inbound_aliases")
    .select("alias, message_count")
    .eq("alias", alias)
    .maybeSingle();

  if (!data) {
    const { error } = await supabase
      .from("inbound_aliases")
      .insert({ alias, message_count: 1, last_received_at: receivedAt });
    if (error && error.code !== DUPLICATE_KEY_CODE) {
      throw new Error(`建立別名 ${alias} 失敗: ${error.message}`);
    }
    return;
  }

  const { error } = await supabase
    .from("inbound_aliases")
    .update({ message_count: (data.message_count ?? 0) + 1, last_received_at: receivedAt })
    .eq("alias", alias);
  if (error) {
    throw new Error(`更新別名 ${alias} 統計失敗: ${error.message}`);
  }
}

/** 以 Message-ID 查重，命中回傳既有列 id */
export async function findDuplicateInboundEmail(
  supabase: SupabaseLike,
  messageId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("inbound_emails")
    .select("id")
    .eq("message_id", messageId)
    .maybeSingle();
  return data?.id ?? null;
}

function sanitizeFilename(filename: string): string {
  const cleaned = filename.replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "attachment").slice(0, 120);
}

/** 上傳 ≤1MB 附件至 Storage；單項失敗只標 dropped，不使整封信失敗 */
export async function uploadInboundAttachments(
  storage: StorageLike,
  emailId: string,
  attachments: InboundAttachmentPayload[],
): Promise<AttachmentMeta[]> {
  const metas: AttachmentMeta[] = [];
  for (const [index, attachment] of attachments.entries()) {
    const base: AttachmentMeta = {
      filename: attachment.filename,
      mime_type: attachment.mimeType,
      size: attachment.size,
      storage_path: null,
      dropped: true,
    };
    if (attachment.dropped || !attachment.contentBase64) {
      metas.push(base);
      continue;
    }

    const path = `${emailId}/${index}_${sanitizeFilename(attachment.filename)}`;
    try {
      const { error } = await storage
        .from(INBOUND_ATTACHMENT_BUCKET)
        .upload(path, Buffer.from(attachment.contentBase64, "base64"), {
          contentType: attachment.mimeType,
          upsert: true,
        });
      if (error) {
        console.error(`附件上傳失敗（${path}）:`, error.message ?? error);
        metas.push(base);
        continue;
      }
      metas.push({ ...base, storage_path: path, dropped: false });
    } catch (err) {
      console.error(`附件上傳失敗（${path}）:`, err);
      metas.push(base);
    }
  }
  return metas;
}

/** 冪等寫入：插入撞唯一索引（23505）視為重複，回傳既有列 id */
export async function saveInboundEmail(
  supabase: SupabaseLike,
  id: string,
  email: NormalizedInboundEmail,
  attachmentsMeta: AttachmentMeta[],
): Promise<{ id: string; duplicate: boolean }> {
  const { error } = await supabase.from("inbound_emails").insert({
    id,
    message_id: email.messageId,
    alias: email.alias,
    from_address: email.fromAddress,
    from_display: email.fromDisplay,
    to_addresses: email.toAddresses,
    subject: email.subject,
    snippet: email.snippet,
    body_html: email.bodyHtml,
    body_plain: email.bodyPlain,
    headers: email.headers,
    attachments: attachmentsMeta,
    has_attachments: attachmentsMeta.length > 0,
    received_at: email.receivedAt,
  });

  if (!error) return { id, duplicate: false };

  if (error.code === DUPLICATE_KEY_CODE) {
    const existingId = await findDuplicateInboundEmail(supabase, email.messageId);
    return { id: existingId ?? id, duplicate: true };
  }

  throw new Error(`寫入站點郵件失敗: ${error.message}`);
}

export async function listAliases(supabase: SupabaseLike): Promise<InboundAliasRow[]> {
  const { data } = await supabase
    .from("inbound_aliases")
    .select("alias, label, site, note, color, is_active, message_count, last_received_at")
    .order("alias", { ascending: true });
  return (data ?? []) as InboundAliasRow[];
}

export async function listInboundEmails(
  supabase: SupabaseLike,
  opts: { alias?: string | null; onlyUnread?: boolean; limit: number; offset: number },
): Promise<{ emails: InboundEmailRow[]; hasMore: boolean }> {
  let query = supabase
    .from("inbound_emails")
    .select("id, alias, from_address, from_display, subject, snippet, has_attachments, is_read, received_at")
    .order("received_at", { ascending: false })
    .range(opts.offset, opts.offset + opts.limit);

  if (opts.alias) query = query.eq("alias", opts.alias);
  if (opts.onlyUnread) query = query.eq("is_read", false);

  const { data } = await query;
  const rows = (data ?? []) as InboundEmailRow[];
  return { emails: rows.slice(0, opts.limit), hasMore: rows.length > opts.limit };
}

export async function updateAlias(
  supabase: SupabaseLike,
  alias: string,
  patch: AliasPatch,
): Promise<{ found: boolean }> {
  const payload: Record<string, unknown> = {};
  if (patch.label !== undefined) payload.label = patch.label;
  if (patch.site !== undefined) payload.site = patch.site;
  if (patch.note !== undefined) payload.note = patch.note;
  if (patch.color !== undefined) payload.color = patch.color;
  if (patch.is_active !== undefined) payload.is_active = patch.is_active;

  const { data, error } = await supabase
    .from("inbound_aliases")
    .update(payload)
    .eq("alias", alias)
    .select("alias");
  if (error) {
    throw new Error(`更新別名 ${alias} 失敗: ${error.message}`);
  }
  return { found: (data ?? []).length > 0 };
}

export async function markInboundRead(supabase: SupabaseLike, id: string, read: boolean): Promise<void> {
  const { error } = await supabase
    .from("inbound_emails")
    .update({ is_read: read })
    .eq("id", id);
  if (error) {
    throw new Error(`更新已讀狀態失敗: ${error.message}`);
  }
}

/** 彙總 since 之後入庫的郵件，供 Discord 摘要使用（上限 500 列，JS 端彙總免 RPC） */
export async function getInboundDigestStats(
  supabase: SupabaseLike,
  sinceIso: string,
): Promise<InboundDigestStats> {
  const { data } = await supabase
    .from("inbound_emails")
    .select("alias, from_address, subject, is_read")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(DIGEST_SCAN_LIMIT);

  const rows = (data ?? []) as { alias: string; from_address: string; subject: string | null; is_read: boolean }[];

  const aliasLabels = new Map<string, string>();
  if (rows.length > 0) {
    for (const alias of await listAliases(supabase)) {
      aliasLabels.set(alias.alias, alias.label);
    }
  }

  const perAliasCounts = new Map<string, number>();
  const senderCounts = new Map<string, number>();
  const notableSubjects: string[] = [];
  let unreadTotal = 0;

  for (const row of rows) {
    perAliasCounts.set(row.alias, (perAliasCounts.get(row.alias) ?? 0) + 1);
    senderCounts.set(row.from_address, (senderCounts.get(row.from_address) ?? 0) + 1);
    if (!row.is_read) unreadTotal += 1;
    if (row.subject && notableSubjects.length < NOTABLE_SUBJECT_COUNT) {
      notableSubjects.push(row.subject);
    }
  }

  return {
    total: rows.length,
    unreadTotal,
    perAlias: [...perAliasCounts.entries()]
      .map(([alias, count]) => ({ alias, label: aliasLabels.get(alias) ?? "未分類", count }))
      .sort((a, b) => b.count - a.count),
    topSenders: [...senderCounts.entries()]
      .map(([fromAddress, count]) => ({ fromAddress, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_SENDER_COUNT),
    notableSubjects,
  };
}
