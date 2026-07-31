import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetSupabase } = vi.hoisted(() => ({ mockGetSupabase: vi.fn() }));

// unwrapQuery 是純邏輯（把 Supabase error 轉成例外），保留真實實作才測得到錯誤傳播
vi.mock("../lib/supabase", async () => {
  const actual = await vi.importActual<typeof import("../lib/supabase")>("../lib/supabase");
  return { getSupabase: mockGetSupabase, unwrapQuery: actual.unwrapQuery, SupabaseQueryError: actual.SupabaseQueryError };
});

import {
  findCandidates,
  isCleanupField,
  matchEmails,
  matchKeyword,
  previewKeyword,
  isCleanupAction,
  listKeywords,
  addKeyword,
  deleteKeyword,
  setKeywordEnabled,
  type MatchableEmail,
} from "../lib/cleanupKeywords";

function email(overrides: Partial<MatchableEmail> & { id: string }): MatchableEmail {
  return {
    sender: "Shopee <noreply@shopee.tw>",
    subject: "限時優惠開跑",
    snippet: "全站免運，最後一天",
    received_at: "2026-07-30T10:00:00Z",
    ...overrides,
  };
}

describe("matchKeyword()", () => {
  it("應忽略大小寫比對", () => {
    expect(matchKeyword(email({ id: "1", subject: "Newsletter Weekly" }), { keyword: "newsletter", field: "subject" })).toBe(true);
    expect(matchKeyword(email({ id: "1", subject: "newsletter weekly" }), { keyword: "NEWSLETTER", field: "subject" })).toBe(true);
  });

  it("指定欄位時不應比對其他欄位", () => {
    const row = email({ id: "1", subject: "優惠通知", sender: "a@example.com", snippet: "無關內容" });
    expect(matchKeyword(row, { keyword: "優惠", field: "subject" })).toBe(true);
    expect(matchKeyword(row, { keyword: "優惠", field: "sender" })).toBe(false);
    expect(matchKeyword(row, { keyword: "優惠", field: "snippet" })).toBe(false);
  });

  it("field 為 any 時應涵蓋寄件者、主旨與摘要", () => {
    const row = email({ id: "1", subject: "無關", sender: "a@example.com", snippet: "折扣碼在此" });
    expect(matchKeyword(row, { keyword: "折扣碼", field: "any" })).toBe(true);
    expect(matchKeyword(row, { keyword: "example.com", field: "any" })).toBe(true);
  });

  it("空白關鍵字不應命中任何郵件", () => {
    expect(matchKeyword(email({ id: "1" }), { keyword: "   ", field: "any" })).toBe(false);
  });

  it("欄位為 null 時不應丟出錯誤", () => {
    const row: MatchableEmail = { id: "1", sender: "a@example.com", subject: null, snippet: null };
    expect(matchKeyword(row, { keyword: "優惠", field: "subject" })).toBe(false);
    expect(matchKeyword(row, { keyword: "example", field: "any" })).toBe(true);
  });
});

describe("matchEmails()", () => {
  const emails = [
    email({ id: "a", subject: "限時優惠開跑" }),
    email({ id: "b", subject: "系統維護公告", sender: "ops@corp.com", snippet: "例行維護" }),
    email({ id: "c", subject: "Weekly Newsletter", sender: "news@media.com", snippet: "本週摘要" }),
  ];

  it("應回傳命中的郵件與對應關鍵字", () => {
    const result = matchEmails(emails, [{ keyword: "優惠", field: "subject", enabled: true }]);
    expect(result).toHaveLength(1);
    expect(result[0].email.id).toBe("a");
    expect(result[0].keyword).toBe("優惠");
  });

  it("同一封郵件命中多個關鍵字時只回傳一次", () => {
    const result = matchEmails(emails, [
      { keyword: "優惠", field: "subject", enabled: true },
      { keyword: "shopee", field: "sender", enabled: true },
    ]);
    expect(result.filter((m) => m.email.id === "a")).toHaveLength(1);
  });

  it("應略過已停用的關鍵字", () => {
    const result = matchEmails(emails, [{ keyword: "優惠", field: "subject", enabled: false }]);
    expect(result).toEqual([]);
  });

  it("沒有啟用中的關鍵字時應回傳空陣列", () => {
    expect(matchEmails(emails, [])).toEqual([]);
    expect(matchEmails(emails, [{ keyword: "  ", field: "any", enabled: true }])).toEqual([]);
  });

  it("完全不命中時應回傳空陣列", () => {
    expect(matchEmails(emails, [{ keyword: "不存在的字串", field: "any", enabled: true }])).toEqual([]);
  });
});

describe("isCleanupField()", () => {
  it("應只接受合法的欄位值", () => {
    expect(isCleanupField("any")).toBe(true);
    expect(isCleanupField("subject")).toBe(true);
    expect(isCleanupField("body")).toBe(false);
    expect(isCleanupField(123)).toBe(false);
  });
});

describe("isCleanupAction()", () => {
  it("應只接受合法的 action 值", () => {
    expect(isCleanupAction("trash")).toBe(true);
    expect(isCleanupAction("read")).toBe(true);
    expect(isCleanupAction("delete")).toBe(false);
    expect(isCleanupAction(42)).toBe(false);
  });
});

/** 依序回應多次 supabase.from() 的鏈式查詢 */
function mockSupabaseQueries(results: unknown[]) {
  const fromMock = vi.fn();
  for (const result of results) {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(result),
      then: (resolve: (v: unknown) => void) => resolve(result),
    };
    fromMock.mockReturnValueOnce(chain);
  }
  mockGetSupabase.mockReturnValue({ from: fromMock } as never);
  return fromMock;
}

describe("previewKeyword()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("關鍵字為空時不應查詢資料庫", async () => {
    const result = await previewKeyword("  ", "any");
    expect(result).toEqual({ total: 0, emails: [] });
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  it("應回傳命中總數與裁切後的郵件清單", async () => {
    const rows = [email({ id: "a" }), email({ id: "b", subject: "無關主旨" })];
    mockSupabaseQueries([{ data: rows, error: null }]);

    const result = await previewKeyword("優惠", "subject", { limit: 1 });
    expect(result.total).toBe(1);
    expect(result.emails).toHaveLength(1);
    expect(result.emails[0].id).toBe("a");
  });
});

describe("findCandidates()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("沒有啟用中的關鍵字時應直接回傳空陣列", async () => {
    mockSupabaseQueries([{ data: [{ id: "k1", keyword: "優惠", field: "subject", action: "trash", enabled: false }], error: null }]);
    expect(await findCandidates("trash")).toEqual([]);
  });

  it("只應比對指定 action 的關鍵字", async () => {
    mockSupabaseQueries([
      {
        data: [
          { id: "k1", keyword: "優惠", field: "subject", action: "trash", enabled: true },
          { id: "k2", keyword: "對帳單", field: "subject", action: "read", enabled: true },
        ],
        error: null,
      },
      { data: [email({ id: "a" }), email({ id: "b", subject: "月結對帳單" })], error: null },
      { data: [], error: null },
    ]);

    const result = await findCandidates("read");
    expect(result.map((m) => m.email.id)).toEqual(["b"]);
  });

  it("應排除已被其他審核單涵蓋的郵件", async () => {
    mockSupabaseQueries([
      { data: [{ id: "k1", keyword: "優惠", field: "subject", action: "trash", enabled: true }], error: null },
      { data: [email({ id: "a" }), email({ id: "b" })], error: null },
      { data: [{ email_ids: ["a"] }], error: null },
    ]);

    const result = await findCandidates("trash");
    expect(result.map((m) => m.email.id)).toEqual(["b"]);
  });

  it("應套用單則審核的郵件數上限", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => email({ id: `id-${i}` }));
    mockSupabaseQueries([
      { data: [{ id: "k1", keyword: "優惠", field: "subject", action: "trash", enabled: true }], error: null },
      { data: rows, error: null },
      { data: [], error: null },
    ]);

    const result = await findCandidates("trash", { limit: 2 });
    expect(result).toHaveLength(2);
  });
});

/** 簡易 mock：一次查詢一條鏈，末端的 .then() 回傳 { data, error } */
function mockOnce(data: unknown) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(data),
    then: (resolve: (v: unknown) => void) => resolve(data),
  };
  const fromMock = vi.fn().mockReturnValue(chain);
  mockGetSupabase.mockReturnValue({ from: fromMock } as never);
  return { chain, fromMock };
}

describe("listKeywords()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("應回傳關鍵字清單", async () => {
    const rows = [
      { id: "k1", keyword: "優惠", field: "subject", action: "trash", enabled: true },
      { id: "k2", keyword: "通知", field: "sender", action: "read", enabled: false },
    ];
    mockOnce({ data: rows, error: null });

    const result = await listKeywords();
    expect(result).toHaveLength(2);
    expect(result[0].keyword).toBe("優惠");
  });

  it("data 為 null 時應回傳空陣列", async () => {
    mockOnce({ data: null, error: null });
    expect(await listKeywords()).toEqual([]);
  });
});

describe("addKeyword()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("應成功新增關鍵字", async () => {
    const returned = { id: "k-new", keyword: "測試", field: "subject", action: "trash", enabled: true };
    mockOnce({ data: returned, error: null });

    const result = await addKeyword("測試", "subject", "trash");
    expect(result.keyword).toBe("測試");
  });

  it("空關鍵字應拋出錯誤", async () => {
    await expect(addKeyword("  ", "any", "read")).rejects.toThrow("關鍵字不可為空");
  });

  it("重複關鍵字（code 23505）應拋出友善錯誤", async () => {
    mockOnce({ data: null, error: { code: "23505", message: "duplicate key" } });
    await expect(addKeyword("重複", "subject", "trash")).rejects.toThrow("已經存在");
  });
});

describe("deleteKeyword()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("應成功刪除關鍵字", async () => {
    mockOnce({ data: null, error: null });
    await expect(deleteKeyword("k-1")).resolves.toBeUndefined();
  });

  it("刪除失敗時應拋出錯誤", async () => {
    mockOnce({ data: null, error: { message: "Not found" } });
    await expect(deleteKeyword("k-999")).rejects.toThrow("Not found");
  });
});

describe("setKeywordEnabled()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("應成功啟用關鍵字", async () => {
    mockOnce({ data: null, error: null });
    await expect(setKeywordEnabled("k-1", true)).resolves.toBeUndefined();
  });

  it("更新失敗時應拋出錯誤", async () => {
    mockOnce({ data: null, error: { message: "Forbidden" } });
    await expect(setKeywordEnabled("k-1", false)).rejects.toThrow("Forbidden");
  });
});

describe("讀取查詢失敗時不得靜默降級", () => {
  beforeEach(() => vi.clearAllMocks());

  const dbError = { data: null, error: { message: "relation \"cleanup_keywords\" does not exist" } };

  /**
   * 修正前：資料表不存在時 listKeywords 回傳空陣列，畫面與「還沒設關鍵字」完全一樣，
   * 送審靜靜跳過不發 Discord 訊息，症狀無法區分。
   */
  it("listKeywords 查詢失敗應拋出而非回傳空陣列", async () => {
    mockSupabaseQueries([dbError]);
    await expect(listKeywords()).rejects.toThrow(/listKeywords.*does not exist/);
  });

  it("previewKeyword 的郵件查詢失敗應拋出", async () => {
    mockSupabaseQueries([{ data: null, error: { message: "timeout" } }]);
    await expect(previewKeyword("優惠", "subject")).rejects.toThrow(/fetchRecentEmails.*timeout/);
  });

  /**
   * 這條特別重要：idsUnderReview 靜默回傳空 Set 會讓已在審核中的郵件被重複送審，
   * 產生重複審核單與重複處理。
   */
  it("idsUnderReview 查詢失敗時 findCandidates 應拋出，不得把郵件當成未送審", async () => {
    mockSupabaseQueries([
      { data: [{ id: "k1", keyword: "優惠", field: "subject", action: "trash", enabled: true }], error: null },
      { data: [email({ id: "a" })], error: null }, // fetchRecentEmails 成功
      { data: null, error: { message: "permission denied" } }, // idsUnderReview 失敗
    ]);

    await expect(findCandidates("trash")).rejects.toThrow(/idsUnderReview.*permission denied/);
  });
});
