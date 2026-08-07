import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  acquireGmailSyncLease,
  releaseGmailSyncLease,
  recordGmailFailure,
  clearGmailFailures,
  recordGmailCooldown,
  handleGmailSyncFailure,
} from "../lib/gmailSyncControl";

vi.mock("../lib/discord", () => ({
  sendGmailBreakerAlert: vi.fn().mockResolvedValue(undefined),
}));

import { sendGmailBreakerAlert } from "../lib/discord";

/** 建立支援 rpc() 與 from() 鏈的 supabase mock */
function makeSupabase(opts?: {
  rpcResult?: unknown;
  rpcError?: unknown;
  updateError?: unknown;
  upsertError?: unknown;
  hasRpc?: boolean;
}) {
  const rpc = vi.fn().mockResolvedValue({
    data: opts?.rpcResult ?? null,
    error: opts?.rpcError ?? null,
  });
  const updateEq = vi.fn();
  const updateChain = {
    eq: (...args: unknown[]) => {
      updateEq(...args);
      return updateChain;
    },
  };
  (updateChain as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve({ error: opts?.updateError ?? null });
  const update = vi.fn().mockReturnValue(updateChain);
  const upsert = vi.fn().mockResolvedValue({ error: opts?.upsertError ?? null });
  const supabase: any = { from: vi.fn().mockReturnValue({ update, upsert }) };
  if (opts?.hasRpc !== false) supabase.rpc = rpc;
  return { supabase, rpc, update, updateEq, upsert };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("acquireGmailSyncLease()", () => {
  it("沒有 rpc() 的舊測試替身應直接回傳 acquired fallback", async () => {
    const { supabase } = makeSupabase({ hasRpc: false });
    const result = await acquireGmailSyncLease(supabase, "me@gmail.com");
    expect(result.status).toBe("acquired");
    expect(result.token).toEqual(expect.any(String));
    expect(result.lastHistoryId).toBeNull();
    expect(result.retryAfter).toBeNull();
    expect(supabase.rpc).toBeUndefined();
  });

  it("acquired 狀態應回傳 token 與游標", async () => {
    const { supabase, rpc } = makeSupabase({
      rpcResult: { status: "acquired", last_history_id: 500, retry_after: null },
    });
    const result = await acquireGmailSyncLease(supabase, "me@gmail.com", "300", 60);

    expect(rpc).toHaveBeenCalledWith("acquire_gmail_sync_lease", expect.objectContaining({
      p_watch_address: "me@gmail.com",
      p_notification_history_id: 300,
      p_lease_seconds: 60,
    }));
    expect(result.status).toBe("acquired");
    expect(result.token).toEqual(expect.any(String));
    expect(result.lastHistoryId).toBe(500);
    expect(result.retryAfter).toBeNull();
  });

  it("data 為陣列時應取第一個元素", async () => {
    const { supabase } = makeSupabase({
      rpcResult: [{ status: "busy", last_history_id: null, retry_after: "2026-08-01T00:00:00Z" }],
    });
    const result = await acquireGmailSyncLease(supabase, "me@gmail.com");
    expect(result.status).toBe("busy");
    expect(result.token).toBeNull();
    expect(result.retryAfter).toBe("2026-08-01T00:00:00Z");
  });

  it("row 缺失或沒有 status 時應視為 busy", async () => {
    const { supabase } = makeSupabase({ rpcResult: null });
    const result = await acquireGmailSyncLease(supabase, "me@gmail.com");
    expect(result.status).toBe("busy");
    expect(result.token).toBeNull();
  });

  it("cooldown 狀態應保留 retryAfter", async () => {
    const { supabase } = makeSupabase({
      rpcResult: { status: "cooldown", retry_after: "2026-08-01T01:00:00Z" },
    });
    const result = await acquireGmailSyncLease(supabase, "me@gmail.com");
    expect(result.status).toBe("cooldown");
    expect(result.retryAfter).toBe("2026-08-01T01:00:00Z");
  });

  it("notificationHistoryId 缺漏時應傳 null", async () => {
    const { supabase, rpc } = makeSupabase({ rpcResult: { status: "acquired" } });
    await acquireGmailSyncLease(supabase, "me@gmail.com");
    expect(rpc).toHaveBeenCalledWith("acquire_gmail_sync_lease", expect.objectContaining({
      p_notification_history_id: null,
    }));
  });

  it("rpc 回傳錯誤時應向外拋出", async () => {
    const { supabase } = makeSupabase({ rpcError: { message: "rpc down" } });
    await expect(acquireGmailSyncLease(supabase, "me@gmail.com")).rejects.toEqual({ message: "rpc down" });
  });
});

describe("releaseGmailSyncLease()", () => {
  it("token 為 null 時不應查詢資料庫", async () => {
    const { supabase } = makeSupabase();
    await releaseGmailSyncLease(supabase, "me@gmail.com", null);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("應以 token 為條件清除 processing 欄位", async () => {
    const { supabase, update, updateEq } = makeSupabase();
    await releaseGmailSyncLease(supabase, "me@gmail.com", "token-1");

    expect(update).toHaveBeenCalledWith({ processing_token: null, processing_until: null });
    expect(updateEq).toHaveBeenCalledWith("watch_address", "me@gmail.com");
    expect(updateEq).toHaveBeenCalledWith("processing_token", "token-1");
  });

  it("更新失敗時應拋出錯誤", async () => {
    const { supabase } = makeSupabase({ updateError: { message: "update failed" } });
    await expect(releaseGmailSyncLease(supabase, "me@gmail.com", "token-1")).rejects.toEqual({ message: "update failed" });
  });
});

describe("recordGmailFailure()", () => {
  it("沒有 rpc() 時應回傳 null", async () => {
    const { supabase } = makeSupabase({ hasRpc: false });
    await expect(recordGmailFailure(supabase, "me@gmail.com", "boom")).resolves.toBeNull();
  });

  it("應傳入時間窗與門檻參數並映射結果", async () => {
    const { supabase, rpc } = makeSupabase({
      rpcResult: {
        consecutive_failures: 3,
        first_failure_at: "2026-08-01T00:00:00Z",
        tripped: true,
        should_notify: true,
        cooldown_until: "2026-08-01T01:00:00Z",
      },
    });
    const result = await recordGmailFailure(supabase, "me@gmail.com", "Gmail 5xx");

    expect(rpc).toHaveBeenCalledWith("record_gmail_failure", expect.objectContaining({
      p_watch_address: "me@gmail.com",
      p_error: "Gmail 5xx",
      p_window_seconds: 300,
      p_min_failures: 3,
      p_cooldown_seconds: 3600,
    }));
    expect(result).toEqual({
      consecutiveFailures: 3,
      firstFailureAt: "2026-08-01T00:00:00Z",
      tripped: true,
      shouldNotify: true,
      cooldownUntil: "2026-08-01T01:00:00Z",
    });
  });

  it("錯誤訊息超過 500 字時應截斷", async () => {
    const { supabase, rpc } = makeSupabase({ rpcResult: {} });
    const longError = "x".repeat(1000);
    await recordGmailFailure(supabase, "me@gmail.com", longError);
    expect(rpc).toHaveBeenCalledWith("record_gmail_failure", expect.objectContaining({
      p_error: "x".repeat(500),
    }));
  });

  it("rpc 回傳 null data 時應回傳 null", async () => {
    const { supabase } = makeSupabase({ rpcResult: null });
    await expect(recordGmailFailure(supabase, "me@gmail.com", "boom")).resolves.toBeNull();
  });

  it("rpc 回傳錯誤時應向外拋出", async () => {
    const { supabase } = makeSupabase({ rpcError: { message: "rpc down" } });
    await expect(recordGmailFailure(supabase, "me@gmail.com", "boom")).rejects.toEqual({ message: "rpc down" });
  });
});

describe("clearGmailFailures()", () => {
  it("應重設熔斷計數與通知時間", async () => {
    const { supabase, update, updateEq } = makeSupabase();
    await clearGmailFailures(supabase, "me@gmail.com");

    expect(update).toHaveBeenCalledWith({
      consecutive_failures: 0,
      first_failure_at: null,
      breaker_notified_at: null,
    });
    expect(updateEq).toHaveBeenCalledWith("watch_address", "me@gmail.com");
  });

  it("更新失敗時應拋出錯誤", async () => {
    const { supabase } = makeSupabase({ updateError: { message: "update failed" } });
    await expect(clearGmailFailures(supabase, "me@gmail.com")).rejects.toEqual({ message: "update failed" });
  });
});

describe("recordGmailCooldown()", () => {
  it("應 upsert cooldown 狀態與錯誤訊息", async () => {
    const { supabase, upsert } = makeSupabase();
    await recordGmailCooldown(supabase, "me@gmail.com", new Date("2026-08-01T00:00:00Z"), "rate limited");

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      watch_address: "me@gmail.com",
      cooldown_until: "2026-08-01T00:00:00.000Z",
      last_sync_error: "rate limited",
    }));
  });

  it("upsert 失敗時應拋出錯誤", async () => {
    const { supabase } = makeSupabase({ upsertError: { message: "upsert failed" } });
    await expect(
      recordGmailCooldown(supabase, "me@gmail.com", new Date(), "rate limited"),
    ).rejects.toEqual({ message: "upsert failed" });
  });
});

describe("handleGmailSyncFailure()", () => {
  it("沒有 watchAddress 時不應記錄失敗", async () => {
    const { supabase, rpc } = makeSupabase();
    await handleGmailSyncFailure(supabase, undefined, "boom", "manualSync");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("未達熔斷門檻時不應發送 Discord 警告", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { supabase } = makeSupabase({
      rpcResult: { tripped: false, consecutive_failures: 1 },
    });
    await handleGmailSyncFailure(supabase, "me@gmail.com", "boom", "manualSync");

    expect(sendGmailBreakerAlert).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("熔斷且尚未通知時應發送一次 Discord 警告", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { supabase } = makeSupabase({
      rpcResult: {
        tripped: true,
        should_notify: true,
        consecutive_failures: 3,
        first_failure_at: "2026-08-01T00:00:00Z",
        cooldown_until: "2026-08-01T01:00:00Z",
      },
    });
    await handleGmailSyncFailure(supabase, "me@gmail.com", "Gmail 5xx", "manualSync");

    expect(warnSpy).toHaveBeenCalledWith("gmail_sync_breaker_tripped", expect.objectContaining({
      operation: "manualSync",
      consecutiveFailures: 3,
    }));
    expect(sendGmailBreakerAlert).toHaveBeenCalledWith({
      watchAddress: "me@gmail.com",
      consecutiveFailures: 3,
      firstFailureAt: "2026-08-01T00:00:00Z",
      cooldownUntil: "2026-08-01T01:00:00Z",
      lastError: "Gmail 5xx",
    });
    warnSpy.mockRestore();
  });

  it("熔斷但已通知過時不應重複發送", async () => {
    const { supabase } = makeSupabase({
      rpcResult: { tripped: true, should_notify: false, consecutive_failures: 4 },
    });
    await handleGmailSyncFailure(supabase, "me@gmail.com", "boom", "manualSync");
    expect(sendGmailBreakerAlert).not.toHaveBeenCalled();
  });

  it("recordGmailFailure 本身失敗時應記錄錯誤但不外拋", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = makeSupabase({ rpcError: new Error("rpc down") });
    await expect(handleGmailSyncFailure(supabase, "me@gmail.com", "boom", "manualSync")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith("gmail_sync_failure_record_failed", expect.objectContaining({
      message: "rpc down",
    }));
    errorSpy.mockRestore();
  });

  it("Discord 警告失敗時應記錄錯誤但不外拋", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendGmailBreakerAlert).mockRejectedValueOnce(new Error("discord down"));
    const { supabase } = makeSupabase({
      rpcResult: { tripped: true, should_notify: true, consecutive_failures: 3 },
    });
    await expect(handleGmailSyncFailure(supabase, "me@gmail.com", "boom", "manualSync")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith("gmail_sync_failure_record_failed", expect.objectContaining({
      message: "discord down",
    }));
    errorSpy.mockRestore();
  });
});
