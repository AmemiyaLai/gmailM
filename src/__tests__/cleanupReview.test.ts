import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetSupabase, mockTrashMessage, mockMarkAsRead, mockSendCleanupReview, mockFindCandidates } = vi.hoisted(() => ({
  mockGetSupabase: vi.fn(),
  mockTrashMessage: vi.fn().mockResolvedValue(undefined),
  mockMarkAsRead: vi.fn().mockResolvedValue(undefined),
  mockSendCleanupReview: vi.fn().mockResolvedValue("discord-msg-1"),
  mockFindCandidates: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({ getSupabase: mockGetSupabase }));
vi.mock("../lib/gmail", () => ({ trashMessage: mockTrashMessage, markAsRead: mockMarkAsRead }));
vi.mock("../lib/discord", () => ({ sendCleanupReview: mockSendCleanupReview }));
vi.mock("../lib/cleanupKeywords", () => ({ findCandidates: mockFindCandidates }));

import { approveReview, dispatchCleanupReview, DISPATCH_COOLDOWN_MS, rejectReview, getReview, listReviews } from "../lib/cleanupReview";

interface ChainCall {
  table: string;
  chain: Record<string, ReturnType<typeof vi.fn>>;
}

/**
 * 每次 supabase.from() 回傳一條鏈，鏈的終端（single / maybeSingle / select-after-update）
 * 由 results 依序提供。
 */
function mockSupabase(results: unknown[]) {
  const calls: ChainCall[] = [];
  let index = 0;

  const fromMock = vi.fn((table: string) => {
    const result = results[index++] ?? { data: null, error: null };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    const self = () => chain;
    for (const method of ["select", "insert", "update", "delete", "eq", "in", "order", "limit"]) {
      chain[method] = vi.fn(self);
    }
    chain.single = vi.fn().mockResolvedValue(result);
    chain.maybeSingle = vi.fn().mockResolvedValue(result);
    // 終端鏈也可能直接被 await（例如 update().eq()）
    (chain as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(result);
    calls.push({ table, chain });
    return chain;
  });

  mockGetSupabase.mockReturnValue({ from: fromMock } as never);
  return { fromMock, calls };
}

function pendingReview(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "review-1",
    action: "trash",
    status: "pending",
    email_ids: ["m1", "m2"],
    matched: [
      { id: "m1", sender: "a@x.com", subject: "優惠一", keyword: "優惠" },
      { id: "m2", sender: "b@x.com", subject: "優惠二", keyword: "優惠" },
    ],
    email_count: 2,
    discord_message_id: null,
    processed_count: null,
    last_error: null,
    created_at: "2026-07-31T00:00:00Z",
    decided_at: null,
    ...overrides,
  };
}

describe("approveReview() — action: trash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTrashMessage.mockResolvedValue(undefined);
  });

  it("應把郵件移到垃圾桶並從 Supabase 移除", async () => {
    const { calls } = mockSupabase([
      { data: [pendingReview()], error: null }, // claimPending
      { data: null, error: null }, // emails delete
      { data: null, error: null }, // 回寫 processed_count
    ]);

    const result = await approveReview("review-1");

    expect(result).toEqual({ status: "approved", action: "trash", processedCount: 2, failedCount: 0 });
    expect(mockTrashMessage).toHaveBeenCalledTimes(2);
    expect(mockTrashMessage).toHaveBeenCalledWith("m1");
    expect(mockMarkAsRead).not.toHaveBeenCalled();
    expect(calls[1].table).toBe("emails");
    expect(calls[1].chain.delete).toHaveBeenCalled();
    expect(calls[1].chain.in).toHaveBeenCalledWith("id", ["m1", "m2"]);
  });

  it("重複審核時不應再次刪除郵件", async () => {
    mockSupabase([{ data: [], error: null }]); // 搶佔失敗：已非 pending

    const result = await approveReview("review-1");

    expect(result).toEqual({ status: "already-handled" });
    expect(mockTrashMessage).not.toHaveBeenCalled();
  });

  it("部分郵件刪除失敗時應回報數量並記錄錯誤", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockTrashMessage
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Gmail 404"));

    const { calls } = mockSupabase([
      { data: [pendingReview()], error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);

    const result = await approveReview("review-1");

    expect(result).toEqual({ status: "approved", action: "trash", processedCount: 1, failedCount: 1 });
    expect(calls[1].chain.in).toHaveBeenCalledWith("id", ["m1"]);
    const updatePayload = calls[2].chain.update.mock.calls[0][0] as { processed_count: number; last_error: string | null };
    expect(updatePayload.processed_count).toBe(1);
    expect(updatePayload.last_error).toContain("Gmail 404");
    consoleSpy.mockRestore();
  });

  it("Supabase 刪除失敗時應記錄到 last_error", async () => {
    const { calls } = mockSupabase([
      { data: [pendingReview()], error: null },
      { data: null, error: { message: "permission denied" } }, // emails delete 失敗
      { data: null, error: null },
    ]);

    const result = await approveReview("review-1");

    // Gmail 端已成功，仍回報成功封數，但錯誤要留痕供 /cleanup 檢視
    expect(result).toEqual({ status: "approved", action: "trash", processedCount: 2, failedCount: 0 });
    const updatePayload = calls[2].chain.update.mock.calls[0][0] as { last_error: string | null };
    expect(updatePayload.last_error).toContain("permission denied");
  });

  it("全部刪除失敗時不應對 emails 表發出 delete", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockTrashMessage.mockRejectedValue(new Error("Gmail down"));

    const { calls } = mockSupabase([
      { data: [pendingReview()], error: null },
      { data: null, error: null },
    ]);

    const result = await approveReview("review-1");

    expect(result).toEqual({ status: "approved", action: "trash", processedCount: 0, failedCount: 2 });
    expect(calls.some((c) => c.table === "emails")).toBe(false);
    consoleSpy.mockRestore();
  });
});

describe("getReview()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("應回傳審核單", async () => {
    mockSupabase([{ data: pendingReview({ action: "read" }), error: null }]);

    const result = await getReview("review-1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("review-1");
    expect(result!.action).toBe("read");
  });

  it("不存在時應回傳 null", async () => {
    mockSupabase([{ data: null, error: null }]);
    expect(await getReview("not-exist")).toBeNull();
  });
});

describe("listReviews()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("應回傳審核單清單", async () => {
    const rows = [
      pendingReview({ id: "r1", action: "trash" }),
      pendingReview({ id: "r2", action: "read" }),
    ];
    mockSupabase([{ data: rows, error: null }]);

    const result = await listReviews(2);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("r1");
    expect(result[1].action).toBe("read");
  });

  it("data 為 null 時應回傳空陣列", async () => {
    mockSupabase([{ data: null, error: null }]);
    expect(await listReviews()).toEqual([]);
  });
});

describe("approveReview() — action: read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkAsRead.mockResolvedValue(undefined);
  });

  it("應標記已讀並更新 Supabase is_read，不刪除郵件", async () => {
    const { calls } = mockSupabase([
      { data: [pendingReview({ action: "read" })], error: null },
      { data: null, error: null }, // emails update is_read
      { data: null, error: null },
    ]);

    const result = await approveReview("review-1");

    expect(result).toEqual({ status: "approved", action: "read", processedCount: 2, failedCount: 0 });
    expect(mockMarkAsRead).toHaveBeenCalledTimes(2);
    expect(mockTrashMessage).not.toHaveBeenCalled();
    expect(calls[1].table).toBe("emails");
    expect(calls[1].chain.delete).not.toHaveBeenCalled();
    expect(calls[1].chain.update).toHaveBeenCalledWith({ is_read: true });
  });
});

describe("rejectReview()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("應標記為取消且不動 Gmail", async () => {
    mockSupabase([{ data: [pendingReview()], error: null }]);

    const result = await rejectReview("review-1");

    expect(result).toEqual({ status: "rejected", action: "trash", emailCount: 2 });
    expect(mockTrashMessage).not.toHaveBeenCalled();
    expect(mockMarkAsRead).not.toHaveBeenCalled();
  });

  it("已處理過的審核應回傳 already-handled", async () => {
    mockSupabase([{ data: [], error: null }]);
    expect(await rejectReview("review-1")).toEqual({ status: "already-handled" });
  });
});

describe("dispatchCleanupReview()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendCleanupReview.mockResolvedValue("discord-msg-1");
  });

  /** dispatchCleanupReview 第一個查詢是取最近一次送審時間（冷卻期判斷） */
  const noRecentDispatch = { data: null, error: null };

  it("兩條審核線都沒有命中時應各自回報 skipped", async () => {
    mockSupabase([noRecentDispatch]);
    mockFindCandidates.mockResolvedValue([]);

    const result = await dispatchCleanupReview();

    expect(result.results).toEqual([
      { action: "trash", status: "skipped", reason: "no matching emails" },
      { action: "read", status: "skipped", reason: "no matching emails" },
    ]);
    expect(result.cooldown).toBeUndefined();
    expect(mockSendCleanupReview).not.toHaveBeenCalled();
  });

  it("應分別為 trash 與 read 建立審核單並送出 Discord 訊息", async () => {
    mockFindCandidates.mockImplementation((action: string) =>
      Promise.resolve(
        action === "trash"
          ? [{ email: { id: "m1", sender: "a@x.com", subject: "優惠一", snippet: "" }, keyword: "優惠" }]
          : [{ email: { id: "m2", sender: "b@x.com", subject: "對帳單", snippet: "" }, keyword: "對帳單" }],
      ),
    );

    mockSupabase([
      noRecentDispatch,
      { data: pendingReview({ action: "trash", email_ids: ["m1"], email_count: 1 }), error: null }, // insert trash
      { data: null, error: null }, // 寫回 trash discord_message_id
      { data: pendingReview({ id: "review-2", action: "read", email_ids: ["m2"], email_count: 1 }), error: null }, // insert read
      { data: null, error: null }, // 寫回 read discord_message_id
    ]);

    const result = await dispatchCleanupReview();

    expect(result.results).toEqual([
      { action: "trash", status: "ok", reviewId: "review-1", emailCount: 1 },
      { action: "read", status: "ok", reviewId: "review-2", emailCount: 1 },
    ]);
    expect(mockSendCleanupReview).toHaveBeenCalledWith(expect.objectContaining({ reviewId: "review-1", action: "trash" }));
    expect(mockSendCleanupReview).toHaveBeenCalledWith(expect.objectContaining({ reviewId: "review-2", action: "read" }));
  });

  it("其中一條審核線 Discord 送出失敗時，另一條仍應正常送出", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFindCandidates.mockImplementation((action: string) =>
      Promise.resolve([{ email: { id: `m-${action}`, sender: "a@x.com", subject: "s", snippet: "" }, keyword: "k" }]),
    );
    mockSendCleanupReview.mockImplementation((payload: { action: string }) =>
      payload.action === "trash" ? Promise.reject(new Error("Bot token 未設定")) : Promise.resolve("discord-msg-2"),
    );

    mockSupabase([
      noRecentDispatch,
      { data: pendingReview({ action: "trash", email_ids: ["m-trash"], email_count: 1 }), error: null },
      { data: null, error: null }, // 標記 trash 審核單為 failed
      { data: pendingReview({ id: "review-2", action: "read", email_ids: ["m-read"], email_count: 1 }), error: null },
      { data: null, error: null }, // 寫回 read discord_message_id
    ]);

    const result = await dispatchCleanupReview();

    expect(result.results[0]).toEqual({ action: "trash", status: "skipped", reason: "Bot token 未設定" });
    expect(result.results[1]).toEqual({ action: "read", status: "ok", reviewId: "review-2", emailCount: 1 });
    consoleSpy.mockRestore();
  });
});

describe("dispatchCleanupReview() — 冷卻期", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendCleanupReview.mockResolvedValue("discord-msg-1");
    mockFindCandidates.mockResolvedValue([
      { email: { id: "m1", sender: "a@x.com", subject: "優惠", snippet: "" }, keyword: "優惠" },
    ]);
  });

  it("距離上次送審不到 5 秒時應整批跳過且不碰 Discord", async () => {
    const oneSecondAgo = new Date(Date.now() - 1_000).toISOString();
    mockSupabase([{ data: { created_at: oneSecondAgo }, error: null }]);

    const result = await dispatchCleanupReview();

    expect(result.cooldown?.retryAfterMs).toBeGreaterThan(0);
    expect(result.cooldown?.retryAfterMs).toBeLessThanOrEqual(DISPATCH_COOLDOWN_MS);
    expect(result.results).toEqual([
      { action: "trash", status: "skipped", reason: "cooldown" },
      { action: "read", status: "skipped", reason: "cooldown" },
    ]);
    expect(mockSendCleanupReview).not.toHaveBeenCalled();
    expect(mockFindCandidates).not.toHaveBeenCalled();
  });

  it("超過冷卻期後應正常送出", async () => {
    const longAgo = new Date(Date.now() - DISPATCH_COOLDOWN_MS - 1_000).toISOString();
    mockSupabase([
      { data: { created_at: longAgo }, error: null },
      { data: pendingReview({ email_ids: ["m1"], email_count: 1 }), error: null },
      { data: null, error: null },
      { data: pendingReview({ id: "review-2", action: "read", email_ids: ["m1"], email_count: 1 }), error: null },
      { data: null, error: null },
    ]);

    const result = await dispatchCleanupReview();

    expect(result.cooldown).toBeUndefined();
    expect(mockSendCleanupReview).toHaveBeenCalledTimes(2);
  });

  it("從未送審過（查無記錄）時不應被冷卻期擋住", async () => {
    mockSupabase([
      { data: null, error: null },
      { data: pendingReview({ email_ids: ["m1"], email_count: 1 }), error: null },
      { data: null, error: null },
      { data: pendingReview({ id: "review-2", action: "read", email_ids: ["m1"], email_count: 1 }), error: null },
      { data: null, error: null },
    ]);

    const result = await dispatchCleanupReview();

    expect(result.cooldown).toBeUndefined();
    expect(mockSendCleanupReview).toHaveBeenCalledTimes(2);
  });
});
