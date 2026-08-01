import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetSupabase, mockTrashMessage, mockMarkAsRead, mockSendCleanupReview, mockFindCandidates } = vi.hoisted(() => ({
  mockGetSupabase: vi.fn(),
  mockTrashMessage: vi.fn().mockResolvedValue(undefined),
  mockMarkAsRead: vi.fn().mockResolvedValue(undefined),
  mockSendCleanupReview: vi.fn().mockResolvedValue("discord-msg-1"),
  mockFindCandidates: vi.fn(),
}));

// unwrapQuery 是純邏輯（把 Supabase error 轉成例外），保留真實實作才測得到錯誤傳播
vi.mock("../lib/supabase", async () => {
  const actual = await vi.importActual<typeof import("../lib/supabase")>("../lib/supabase");
  return { getSupabase: mockGetSupabase, unwrapQuery: actual.unwrapQuery, SupabaseQueryError: actual.SupabaseQueryError };
});
vi.mock("../lib/gmail", () => ({ trashMessage: mockTrashMessage, markAsRead: mockMarkAsRead }));
vi.mock("../lib/discord", () => ({ sendCleanupReview: mockSendCleanupReview }));
vi.mock("../lib/cleanupKeywords", () => ({ findCandidates: mockFindCandidates }));

import {
  approveReview, dispatchCleanupReview, DISPATCH_COOLDOWN_MS, rejectReview,
  getReview, listReviews, resumeStuckReviews, STUCK_REVIEW_THRESHOLD_MS,
  getPendingReviewCount, listPendingReviews, processCandidatesNow,
} from "../lib/cleanupReview";

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
    for (const method of ["select", "insert", "update", "delete", "eq", "in", "order", "limit", "is", "lt"]) {
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

describe("resumeStuckReviews()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTrashMessage.mockResolvedValue(undefined);
    mockMarkAsRead.mockResolvedValue(undefined);
  });

  it("沒有中斷的審核單時應回報 0 且不碰 Gmail", async () => {
    mockSupabase([{ data: [], error: null }]);

    expect(await resumeStuckReviews()).toEqual({ resumed: 0, processed: 0 });
    expect(mockTrashMessage).not.toHaveBeenCalled();
    expect(mockMarkAsRead).not.toHaveBeenCalled();
  });

  it("應只查詢 approved 且 processed_count 為 null、且超過門檻時間的審核單", async () => {
    const { calls } = mockSupabase([{ data: [], error: null }]);

    await resumeStuckReviews();

    const chain = calls[0].chain;
    expect(calls[0].table).toBe("cleanup_reviews");
    expect(chain.eq).toHaveBeenCalledWith("status", "approved");
    expect(chain.is).toHaveBeenCalledWith("processed_count", null);

    // 門檻時間應為「現在減去 STUCK_REVIEW_THRESHOLD_MS」
    const [column, cutoff] = chain.lt.mock.calls[0] as [string, string];
    expect(column).toBe("decided_at");
    const drift = Math.abs(Date.now() - STUCK_REVIEW_THRESHOLD_MS - new Date(cutoff).getTime());
    expect(drift).toBeLessThan(5_000);
  });

  it("應補做中斷的 trash 審核單並回寫處理數量", async () => {
    const { calls } = mockSupabase([
      { data: [pendingReview({ status: "approved" })], error: null }, // 查詢卡住的審核單
      { data: null, error: null }, // emails delete
      { data: null, error: null }, // 回寫 processed_count
    ]);

    const result = await resumeStuckReviews();

    expect(result).toEqual({ resumed: 1, processed: 2 });
    expect(mockTrashMessage).toHaveBeenCalledTimes(2);
    expect(calls[1].chain.delete).toHaveBeenCalled();
    const payload = calls[2].chain.update.mock.calls[0][0] as { processed_count: number };
    expect(payload.processed_count).toBe(2);
  });

  it("應依 action 補做 read 審核單（標記已讀而非刪除）", async () => {
    const { calls } = mockSupabase([
      { data: [pendingReview({ status: "approved", action: "read" })], error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);

    const result = await resumeStuckReviews();

    expect(result).toEqual({ resumed: 1, processed: 2 });
    expect(mockMarkAsRead).toHaveBeenCalledTimes(2);
    expect(mockTrashMessage).not.toHaveBeenCalled();
    expect(calls[1].chain.update).toHaveBeenCalledWith({ is_read: true });
  });

  it("單筆補做失敗不應中斷其他筆", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 第一筆的 Gmail 呼叫全部失敗，第二筆成功
    mockTrashMessage
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);

    mockSupabase([
      {
        data: [
          pendingReview({ id: "r1", status: "approved" }),
          pendingReview({ id: "r2", status: "approved", email_ids: ["m3"] }),
        ],
        error: null,
      },
      { data: null, error: null }, // r1 回寫（0 封成功，不會 delete）
      { data: null, error: null }, // r2 emails delete
      { data: null, error: null }, // r2 回寫
    ]);

    const result = await resumeStuckReviews();

    expect(result.resumed).toBe(2);
    expect(result.processed).toBe(1); // 只有 r2 的那一封成功
    consoleSpy.mockRestore();
    consoleWarn.mockRestore();
  });
});

describe("查詢失敗時不得靜默降級", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTrashMessage.mockResolvedValue(undefined);
  });

  const dbError = { data: null, error: { message: "relation \"cleanup_reviews\" does not exist" } };

  /**
   * 這是本次修正的核心迴歸測試。
   * 修正前：claimPending 只取 data，查詢失敗 → 回傳 null → approveReview 回報 already-handled，
   * 使用者看到「已經處理過了」但郵件其實完全沒被處理。
   */
  it("claimPending 查詢失敗時 approveReview 應拋出，不得回報 already-handled", async () => {
    mockSupabase([dbError]);

    await expect(approveReview("review-1")).rejects.toThrow(/claimPending/);
    expect(mockTrashMessage).not.toHaveBeenCalled();
  });

  it("claimPending 查詢失敗時 rejectReview 也應拋出", async () => {
    mockSupabase([dbError]);
    await expect(rejectReview("review-1")).rejects.toThrow(/claimPending/);
  });

  it("getReview / listReviews / listPendingReviews 查詢失敗應拋出", async () => {
    mockSupabase([dbError]);
    await expect(getReview("review-1")).rejects.toThrow(/getReview/);

    mockSupabase([dbError]);
    await expect(listReviews()).rejects.toThrow(/listReviews/);

    mockSupabase([dbError]);
    await expect(listPendingReviews()).rejects.toThrow(/listPendingReviews/);
  });

  it("resumeStuckReviews 查詢失敗應拋出而非當作沒有卡住的審核單", async () => {
    mockSupabase([dbError]);
    await expect(resumeStuckReviews()).rejects.toThrow(/resumeStuckReviews/);
  });

  it("processed_count 寫入失敗時不應改寫回傳結果，但要留下錯誤記錄", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSupabase([
      { data: [pendingReview()], error: null }, // claimPending
      { data: null, error: null }, // emails delete
      { data: null, error: { message: "write timeout" } }, // 回寫 processed_count 失敗
    ]);

    // Gmail 動作已完成，仍要如實回報成功封數
    const result = await approveReview("review-1");
    expect(result).toEqual({ status: "approved", action: "trash", processedCount: 2, failedCount: 0 });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("寫入 processed_count 失敗"),
      "write timeout",
    );
    consoleSpy.mockRestore();
  });
});

describe("getPendingReviewCount()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("應回傳審核單數與郵件數加總", async () => {
    const { calls } = mockSupabase([
      { data: [{ email_count: 25 }, { email_count: 7 }], error: null },
    ]);

    expect(await getPendingReviewCount()).toEqual({ reviews: 2, emails: 32 });
    expect(calls[0].chain.eq).toHaveBeenCalledWith("status", "pending");
  });

  it("沒有 pending 時應回傳 0", async () => {
    mockSupabase([{ data: [], error: null }]);
    expect(await getPendingReviewCount()).toEqual({ reviews: 0, emails: 0 });
  });

  it("email_count 為 null 時應視為 0 而非 NaN", async () => {
    mockSupabase([{ data: [{ email_count: null }, { email_count: 3 }], error: null }]);
    expect(await getPendingReviewCount()).toEqual({ reviews: 2, emails: 3 });
  });
});

describe("listPendingReviews()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("應只查 pending 狀態", async () => {
    const { calls } = mockSupabase([{ data: [pendingReview()], error: null }]);

    const rows = await listPendingReviews(10);

    expect(rows).toHaveLength(1);
    expect(calls[0].chain.eq).toHaveBeenCalledWith("status", "pending");
    expect(calls[0].chain.limit).toHaveBeenCalledWith(10);
  });
});

describe("processCandidatesNow()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTrashMessage.mockResolvedValue(undefined);
    mockMarkAsRead.mockResolvedValue(undefined);
  });

  it("沒有候選時應跳過且不建立審核單", async () => {
    mockFindCandidates.mockResolvedValue([]);
    mockSupabase([]);

    expect(await processCandidatesNow("trash")).toEqual({ status: "skipped", reason: "no matching emails" });
    expect(mockTrashMessage).not.toHaveBeenCalled();
  });

  it("應建立審核單並立即執行，且不經 Discord", async () => {
    mockFindCandidates.mockResolvedValue([
      { email: { id: "m1", sender: "a@x.com", subject: "優惠", snippet: "" }, keyword: "優惠" },
      { email: { id: "m2", sender: "b@x.com", subject: "優惠二", snippet: "" }, keyword: "優惠" },
    ]);
    mockSupabase([
      { data: pendingReview(), error: null }, // createPendingReview insert…single
      { data: [pendingReview({ status: "approved" })], error: null }, // claimPending
      { data: null, error: null }, // emails delete
      { data: null, error: null }, // 回寫 processed_count
    ]);

    const result = await processCandidatesNow("trash");

    expect(result).toEqual({
      status: "ok",
      action: "trash",
      reviewId: "review-1",
      processedCount: 2,
      failedCount: 0,
    });
    expect(mockTrashMessage).toHaveBeenCalledTimes(2);
    expect(mockSendCleanupReview).not.toHaveBeenCalled();
  });

  it("read 動作應標記已讀而非刪除", async () => {
    mockFindCandidates.mockResolvedValue([
      { email: { id: "m1", sender: "a@x.com", subject: "對帳單", snippet: "" }, keyword: "對帳單" },
    ]);
    mockSupabase([
      { data: pendingReview({ action: "read" }), error: null },
      { data: [pendingReview({ action: "read", status: "approved" })], error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);

    const result = await processCandidatesNow("read");

    expect(result).toMatchObject({ status: "ok", action: "read" });
    expect(mockMarkAsRead).toHaveBeenCalled();
    expect(mockTrashMessage).not.toHaveBeenCalled();
  });

  it("搶佔失敗（剛被別的入口處理掉）時應跳過", async () => {
    mockFindCandidates.mockResolvedValue([
      { email: { id: "m1", sender: "a@x.com", subject: "優惠", snippet: "" }, keyword: "優惠" },
    ]);
    mockSupabase([
      { data: pendingReview(), error: null }, // createPendingReview
      { data: [], error: null }, // claimPending 搶不到
    ]);

    expect(await processCandidatesNow("trash")).toEqual({ status: "skipped", reason: "already handled" });
    expect(mockTrashMessage).not.toHaveBeenCalled();
  });
});
