import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initReviewList } from "../lib/reviewListClient";

const fetchMock = vi.fn();
const reloadMock = vi.fn();

interface Harness {
  click: () => Promise<void>;
  button: { disabled: boolean; textContent: string | null; dataset: Record<string, string> };
  status: { textContent: string; style: { color: string } };
  root: unknown;
}

/**
 * 用純物件假造 DOM（比照 inboundListClient.test.ts）：
 * root 只需要 dataset / addEventListener / querySelector，事件委派靠 target.closest。
 */
function createHarness(options: {
  action?: string;
  decision?: string;
  cleanupAction?: string;
  /** null 代表卡片上沒有 data-review-id */
  reviewId?: string | null;
} = {}): Harness {
  const { action = "decide", decision = "approve", cleanupAction, reviewId = "r1" } = options;

  const status = { textContent: "", style: { color: "" } };

  const reviewCard = { dataset: reviewId === null ? {} : { reviewId } };

  const button = {
    disabled: false,
    textContent: "✅ 確認刪除",
    dataset: {
      action,
      ...(decision ? { decision } : {}),
      ...(cleanupAction ? { cleanupAction } : {}),
    } as Record<string, string>,
    closest: vi.fn((selector: string) => (selector === "[data-review-id]" ? reviewCard : null)),
  };

  const target = {
    closest: vi.fn((selector: string) => (selector === "[data-action]" ? button : null)),
  };

  const listeners: ((e: unknown) => Promise<void> | void)[] = [];
  const root = {
    dataset: {} as Record<string, string>,
    addEventListener: vi.fn((event: string, fn: (e: unknown) => void) => {
      if (event === "click") listeners.push(fn);
    }),
    querySelector: vi.fn((selector: string) => (selector === "#review-status" ? status : null)),
  };

  initReviewList(root as unknown as HTMLElement);

  return {
    root,
    button,
    status,
    click: async () => {
      for (const fn of listeners) await fn({ target });
    },
  };
}

describe("initReviewList()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    reloadMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { reload: reloadMock, pathname: "/reviews" } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function okResponse(body: unknown) {
    return { ok: true, json: async () => body };
  }

  it("重複初始化不應重複註冊 listener", () => {
    const h = createHarness();
    initReviewList(h.root as unknown as HTMLElement);
    // 第一次呼叫已在 createHarness 內完成，第二次應被 dataset 標記擋掉
    expect((h.root as { addEventListener: { mock: { calls: unknown[] } } }).addEventListener.mock.calls).toHaveLength(1);
  });

  it("確認刪除應 POST 到 /api/cleanup/review 並帶上 reviewId 與 decision", async () => {
    fetchMock.mockResolvedValue(okResponse({ status: "approved", action: "trash", processedCount: 3, failedCount: 0 }));

    const h = createHarness({ decision: "approve" });
    await h.click();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/cleanup/review");
    expect(JSON.parse(init.body as string)).toEqual({ reviewId: "r1", decision: "approve" });
    expect(h.status.textContent).toContain("已移至垃圾桶 3 封");
  });

  it("read 動作的成功訊息應說明標記為已讀", async () => {
    fetchMock.mockResolvedValue(okResponse({ status: "approved", action: "read", processedCount: 8, failedCount: 0 }));

    const h = createHarness({ decision: "approve" });
    await h.click();

    expect(h.status.textContent).toContain("已標記為已讀 8 封");
  });

  it("有失敗封數時訊息應一併說明", async () => {
    fetchMock.mockResolvedValue(okResponse({ status: "approved", action: "trash", processedCount: 2, failedCount: 1 }));

    const h = createHarness({ decision: "approve" });
    await h.click();

    expect(h.status.textContent).toContain("另有 1 封失敗");
  });

  it("取消應顯示郵件保持原狀", async () => {
    fetchMock.mockResolvedValue(okResponse({ status: "rejected", action: "trash", emailCount: 4 }));

    const h = createHarness({ decision: "reject" });
    await h.click();

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).decision).toBe("reject");
    expect(h.status.textContent).toContain("4 封郵件保持原狀");
  });

  it("already-handled 應提示可能已在 Discord 處理過", async () => {
    fetchMock.mockResolvedValue(okResponse({ status: "already-handled" }));

    const h = createHarness({ decision: "approve" });
    await h.click();

    expect(h.status.textContent).toContain("Discord");
  });

  it("成功後應重載頁面", async () => {
    fetchMock.mockResolvedValue(okResponse({ status: "rejected", action: "trash", emailCount: 1 }));

    const h = createHarness({ decision: "reject" });
    await h.click();
    await vi.runAllTimersAsync();

    expect(reloadMock).toHaveBeenCalled();
  });

  it("直接處理應 POST 到 /api/cleanup/process-now 並帶上 action", async () => {
    fetchMock.mockResolvedValue(okResponse({ status: "ok", action: "read", processedCount: 12, failedCount: 0 }));

    const h = createHarness({ action: "process-now", decision: "", cleanupAction: "read" });
    await h.click();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/cleanup/process-now");
    expect(JSON.parse(init.body as string)).toEqual({ action: "read" });
    expect(h.status.textContent).toContain("已標記為已讀 12 封");
  });

  it("直接處理無候選時應顯示對應訊息", async () => {
    fetchMock.mockResolvedValue(okResponse({ status: "skipped", reason: "no matching emails" }));

    const h = createHarness({ action: "process-now", decision: "", cleanupAction: "trash" });
    await h.click();

    expect(h.status.textContent).toContain("沒有尚未送審的候選郵件");
  });

  it("伺服器回錯誤時應顯示訊息、還原按鈕且不重載", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "claimPending 查詢失敗：timeout" }) });

    const h = createHarness({ decision: "approve" });
    await h.click();

    expect(h.status.textContent).toContain("claimPending");
    expect(h.status.style.color).toBe("var(--color-error)");
    expect(h.button.disabled).toBe(false);
    expect(h.button.textContent).toBe("✅ 確認刪除");

    await vi.runAllTimersAsync();
    expect(reloadMock).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("fetch 直接拋錯時也應還原按鈕", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error("network down"));

    const h = createHarness({ decision: "approve" });
    await h.click();

    expect(h.status.textContent).toContain("network down");
    expect(h.button.disabled).toBe(false);
    consoleSpy.mockRestore();
  });

  it("非審核相關的按鈕應被忽略", async () => {
    const h = createHarness({ action: "save-alias" });
    await h.click();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("找不到 reviewId 時不應發送請求", async () => {
    const h = createHarness({ reviewId: null });
    await h.click();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("decision 不合法時不應發送請求", async () => {
    const h = createHarness({ decision: "explode" });
    await h.click();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("process-now 缺少 cleanupAction 時不應發送請求", async () => {
    const h = createHarness({ action: "process-now", decision: "" });
    await h.click();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
