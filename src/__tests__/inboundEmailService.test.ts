import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedInboundEmail } from "../lib/inboundEmail";
import {
  INBOUND_ATTACHMENT_BUCKET,
  ensureAlias,
  findDuplicateInboundEmail,
  getInboundDigestStats,
  listAliases,
  listInboundEmails,
  markInboundRead,
  saveInboundEmail,
  updateAlias,
  uploadInboundAttachments,
} from "../lib/inboundEmailService";

/** 可鏈式呼叫、可 await 的查詢 mock，await 時解析為指定結果 */
function createChain(result: unknown) {
  const chain: any = {};
  for (const method of ["select", "eq", "gte", "order", "limit", "range", "insert", "update", "maybeSingle"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function createSupabase(...chains: any[]) {
  const from = vi.fn();
  for (const chain of chains) from.mockReturnValueOnce(chain);
  return { supabase: { from }, from };
}

const NOW = "2026-07-31T00:00:00.000Z";

const EMAIL: NormalizedInboundEmail = {
  messageId: "<m1@example.com>",
  alias: "blog",
  fromAddress: "sender@example.com",
  fromDisplay: "寄件者",
  toAddresses: ["blog@autodesignlab.org"],
  subject: "主旨",
  snippet: "摘要",
  bodyHtml: "<p>hi</p>",
  bodyPlain: "hi",
  headers: {},
  attachments: [],
  receivedAt: NOW,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureAlias", () => {
  it("未知別名時自動建檔並帶入統計欄位", async () => {
    const selectChain = createChain({ data: null });
    const insertChain = createChain({ error: null });
    const { supabase, from } = createSupabase(selectChain, insertChain);

    await ensureAlias(supabase, "blog", NOW);

    expect(from).toHaveBeenNthCalledWith(1, "inbound_aliases");
    expect(insertChain.insert).toHaveBeenCalledWith({
      alias: "blog",
      message_count: 1,
      last_received_at: NOW,
    });
  });

  it("既有別名時累加 message_count 並更新 last_received_at", async () => {
    const selectChain = createChain({ data: { alias: "blog", message_count: 4 } });
    const updateChain = createChain({ error: null });
    const { supabase } = createSupabase(selectChain, updateChain);

    await ensureAlias(supabase, "blog", NOW);

    expect(updateChain.update).toHaveBeenCalledWith({ message_count: 5, last_received_at: NOW });
    expect(updateChain.eq).toHaveBeenCalledWith("alias", "blog");
  });

  it("插入撞唯一索引（併發）不視為錯誤", async () => {
    const selectChain = createChain({ data: null });
    const insertChain = createChain({ error: { code: "23505", message: "duplicate" } });
    const { supabase } = createSupabase(selectChain, insertChain);

    await expect(ensureAlias(supabase, "blog", NOW)).resolves.toBeUndefined();
  });

  it("其他插入錯誤會拋出", async () => {
    const selectChain = createChain({ data: null });
    const insertChain = createChain({ error: { code: "XX000", message: "boom" } });
    const { supabase } = createSupabase(selectChain, insertChain);

    await expect(ensureAlias(supabase, "blog", NOW)).rejects.toThrow("建立別名 blog 失敗");
  });
});

describe("findDuplicateInboundEmail", () => {
  it("命中時回傳既有列 id", async () => {
    const chain = createChain({ data: { id: "uuid-1" } });
    const { supabase } = createSupabase(chain);
    await expect(findDuplicateInboundEmail(supabase, "<m1>")).resolves.toBe("uuid-1");
    expect(chain.eq).toHaveBeenCalledWith("message_id", "<m1>");
  });

  it("未命中回傳 null", async () => {
    const { supabase } = createSupabase(createChain({ data: null }));
    await expect(findDuplicateInboundEmail(supabase, "<m1>")).resolves.toBeNull();
  });
});

describe("saveInboundEmail", () => {
  it("插入成功回傳原 id 且 duplicate 為 false", async () => {
    const insertChain = createChain({ error: null });
    const { supabase } = createSupabase(insertChain);

    const result = await saveInboundEmail(supabase, "uuid-new", EMAIL, []);

    expect(result).toEqual({ id: "uuid-new", duplicate: false });
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "uuid-new",
        message_id: EMAIL.messageId,
        alias: "blog",
        has_attachments: false,
      }),
    );
  });

  it("插入撞 23505 視為重複並回傳既有列 id", async () => {
    const insertChain = createChain({ error: { code: "23505", message: "duplicate" } });
    const lookupChain = createChain({ data: { id: "uuid-existing" } });
    const { supabase } = createSupabase(insertChain, lookupChain);

    const result = await saveInboundEmail(supabase, "uuid-new", EMAIL, []);

    expect(result).toEqual({ id: "uuid-existing", duplicate: true });
  });

  it("其他插入錯誤會拋出", async () => {
    const insertChain = createChain({ error: { code: "XX000", message: "boom" } });
    const { supabase } = createSupabase(insertChain);

    await expect(saveInboundEmail(supabase, "uuid-new", EMAIL, [])).rejects.toThrow("寫入站點郵件失敗");
  });

  it("附件 metadata 會寫入 attachments 與 has_attachments", async () => {
    const insertChain = createChain({ error: null });
    const { supabase } = createSupabase(insertChain);
    const metas = [{ filename: "a.txt", mime_type: "text/plain", size: 3, storage_path: "p", dropped: false }];

    await saveInboundEmail(supabase, "uuid-new", EMAIL, metas);

    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: metas, has_attachments: true }),
    );
  });
});

describe("uploadInboundAttachments", () => {
  function createStorage(uploadResult: unknown) {
    const upload = vi.fn(async () => uploadResult);
    const from = vi.fn(() => ({ upload }));
    return { storage: { from }, from, upload };
  }

  it("dropped 或無內容的附件不上傳", async () => {
    const { storage, upload } = createStorage({ error: null });
    const metas = await uploadInboundAttachments(storage, "uuid-1", [
      { filename: "big.pdf", mimeType: "application/pdf", size: 999, contentBase64: null, dropped: true },
    ]);

    expect(upload).not.toHaveBeenCalled();
    expect(metas[0]).toMatchObject({ storage_path: null, dropped: true });
  });

  it("小附件上傳成功並記錄 storage_path", async () => {
    const { storage, from, upload } = createStorage({ error: null });
    const metas = await uploadInboundAttachments(storage, "uuid-1", [
      { filename: "備註 檔.txt", mimeType: "text/plain", size: 5, contentBase64: "aGVsbG8=", dropped: false },
    ]);

    expect(from).toHaveBeenCalledWith(INBOUND_ATTACHMENT_BUCKET);
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^uuid-1\/0_/),
      expect.anything(),
      { contentType: "text/plain", upsert: true },
    );
    expect(metas[0]).toMatchObject({ dropped: false });
    expect(metas[0].storage_path).toMatch(/^uuid-1\/0_/);
  });

  it("上傳失敗時只標記該附件為 dropped", async () => {
    const { storage } = createStorage({ error: { message: "storage down" } });
    const metas = await uploadInboundAttachments(storage, "uuid-1", [
      { filename: "a.txt", mimeType: "text/plain", size: 5, contentBase64: "aGVsbG8=", dropped: false },
    ]);

    expect(metas[0]).toMatchObject({ storage_path: null, dropped: true });
  });
});

describe("listAliases / listInboundEmails", () => {
  it("listAliases 依別名排序回傳", async () => {
    const chain = createChain({ data: [{ alias: "app" }, { alias: "blog" }] });
    const { supabase } = createSupabase(chain);

    const aliases = await listAliases(supabase);

    expect(aliases).toHaveLength(2);
    expect(chain.order).toHaveBeenCalledWith("alias", { ascending: true });
  });

  it("listInboundEmails 套用別名與未讀篩選並計算 hasMore", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `id-${i}` }));
    const chain = createChain({ data: rows });
    const { supabase } = createSupabase(chain);

    const result = await listInboundEmails(supabase, { alias: "blog", onlyUnread: true, limit: 2, offset: 0 });

    expect(chain.eq).toHaveBeenCalledWith("alias", "blog");
    expect(chain.eq).toHaveBeenCalledWith("is_read", false);
    expect(chain.range).toHaveBeenCalledWith(0, 2);
    expect(result.emails).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it("listInboundEmails 無篩選時不呼叫 eq", async () => {
    const chain = createChain({ data: [] });
    const { supabase } = createSupabase(chain);

    const result = await listInboundEmails(supabase, { limit: 50, offset: 50 });

    expect(chain.eq).not.toHaveBeenCalled();
    expect(chain.range).toHaveBeenCalledWith(50, 100);
    expect(result).toEqual({ emails: [], hasMore: false });
  });
});

describe("updateAlias", () => {
  it("更新成功回傳 found true，且只帶有值的欄位", async () => {
    const chain = createChain({ data: [{ alias: "blog" }], error: null });
    const { supabase } = createSupabase(chain);

    const result = await updateAlias(supabase, "blog", { label: "部落格", site: "blog.autodesignlab.org" });

    expect(chain.update).toHaveBeenCalledWith({ label: "部落格", site: "blog.autodesignlab.org" });
    expect(result).toEqual({ found: true });
  });

  it("找不到別名回傳 found false", async () => {
    const chain = createChain({ data: [], error: null });
    const { supabase } = createSupabase(chain);

    await expect(updateAlias(supabase, "nope", { label: "x" })).resolves.toEqual({ found: false });
  });

  it("更新錯誤會拋出", async () => {
    const chain = createChain({ data: null, error: { message: "boom" } });
    const { supabase } = createSupabase(chain);

    await expect(updateAlias(supabase, "blog", { label: "x" })).rejects.toThrow("更新別名 blog 失敗");
  });
});

describe("markInboundRead", () => {
  it("更新 is_read 欄位", async () => {
    const chain = createChain({ error: null });
    const { supabase } = createSupabase(chain);

    await markInboundRead(supabase, "uuid-1", true);

    expect(chain.update).toHaveBeenCalledWith({ is_read: true });
    expect(chain.eq).toHaveBeenCalledWith("id", "uuid-1");
  });

  it("錯誤時拋出", async () => {
    const chain = createChain({ error: { message: "boom" } });
    const { supabase } = createSupabase(chain);

    await expect(markInboundRead(supabase, "uuid-1", false)).rejects.toThrow("更新已讀狀態失敗");
  });
});

describe("getInboundDigestStats", () => {
  it("彙總各別名數量、常見寄件者、未讀數與主旨", async () => {
    const rows = [
      { alias: "blog", from_address: "a@x.com", subject: "S1", is_read: false },
      { alias: "blog", from_address: "a@x.com", subject: "S2", is_read: true },
      { alias: "app", from_address: "b@y.com", subject: null, is_read: false },
    ];
    const emailChain = createChain({ data: rows });
    const aliasChain = createChain({
      data: [
        { alias: "blog", label: "部落格" },
        { alias: "app", label: "未分類" },
      ],
    });
    const { supabase } = createSupabase(emailChain, aliasChain);

    const stats = await getInboundDigestStats(supabase, NOW);

    expect(emailChain.gte).toHaveBeenCalledWith("created_at", NOW);
    expect(stats.total).toBe(3);
    expect(stats.unreadTotal).toBe(2);
    expect(stats.perAlias).toEqual([
      { alias: "blog", label: "部落格", count: 2 },
      { alias: "app", label: "未分類", count: 1 },
    ]);
    expect(stats.topSenders[0]).toEqual({ fromAddress: "a@x.com", count: 2 });
    expect(stats.notableSubjects).toEqual(["S1", "S2"]);
  });

  it("零新信時回傳空統計且不查詢別名表", async () => {
    const emailChain = createChain({ data: [] });
    const { supabase, from } = createSupabase(emailChain);

    const stats = await getInboundDigestStats(supabase, NOW);

    expect(stats).toEqual({ total: 0, unreadTotal: 0, perAlias: [], topSenders: [], notableSubjects: [] });
    expect(from).toHaveBeenCalledTimes(1);
  });
});
