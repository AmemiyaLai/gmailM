import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockBuildEmailRowElement, createdElements } = vi.hoisted(() => {
  const createdElements: Array<Record<string, any>> = [];
  (globalThis as any).document = {
    getElementById: vi.fn(),
    querySelector: vi.fn(),
    addEventListener: vi.fn(),
    createElement: vi.fn((tag: string) => {
      const el = {
        tagName: tag,
        className: "",
        style: {} as Record<string, string>,
        textContent: "",
        appendChild: vi.fn(),
      };
      createdElements.push(el);
      return el;
    }),
  };
  (globalThis as any).window = {
    location: { pathname: "/" },
  };
  const mockBuildEmailRowElement = vi.fn(() => ({
    classList: { add: vi.fn(), remove: vi.fn() },
  }));
  return { mockBuildEmailRowElement, createdElements };
});

const { mockPusherSubscribe, bindMock } = vi.hoisted(() => {
  const bindMock = vi.fn<(event: string, callback: (...args: any[]) => void) => void>();
  return {
    mockPusherSubscribe: vi.fn(() => ({ bind: bindMock })),
    bindMock,
  };
});

vi.mock("pusher-js", () => ({
  default: vi.fn().mockImplementation(function () {
    return { subscribe: mockPusherSubscribe };
  }),
}));

vi.mock("../lib/emailCardHtml", () => ({
  buildEmailRowElement: mockBuildEmailRowElement,
}));

/** 依 selector 分派的 DOM mock：connection-status / email-list / .email-row */
function setupDom(opts?: { existingRow?: boolean }) {
  const statusIconEl = { textContent: "" };
  const statusLabelEl = { textContent: "" };
  const statusEl = {
    dataset: {} as Record<string, string>,
    setAttribute: vi.fn(),
    querySelector: vi.fn((selector: string) =>
      selector === "[data-connection-icon]" ? statusIconEl : statusLabelEl),
  };
  const emailListEl = { prepend: vi.fn() };
  const linkEl = {
    querySelectorAll: vi.fn(() => [] as { remove: () => void }[]),
    appendChild: vi.fn(),
  };
  const rowEl = {
    classList: { add: vi.fn(), remove: vi.fn() },
    querySelector: vi.fn(() => linkEl),
  };

  vi.mocked(document.getElementById).mockImplementation((id: string) => {
    if (id === "connection-status") return statusEl as unknown as HTMLElement;
    if (id === "email-list") return emailListEl as unknown as HTMLElement;
    return null;
  });
  vi.mocked(document.querySelector).mockImplementation((selector: string) => {
    if (selector.startsWith(".email-row")) {
      return opts?.existingRow ? (rowEl as unknown as HTMLElement) : null;
    }
    return null;
  });
  return { statusEl, statusIconEl, statusLabelEl, emailListEl, rowEl, linkEl };
}

function findHandler(event: string) {
  return bindMock.mock.calls.find(([e]) => e === event)?.[1];
}

const newEmailPayload = {
  id: "msg-1",
  sender: "Alice <alice@example.com>",
  subject: "Hello",
  snippet: "snippet",
  received_at: "2026-08-01T10:00:00.000Z",
};

describe("startRealtimeConnection()", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    createdElements.length = 0;
    vi.stubEnv("PUBLIC_PUSHER_KEY", "test-key");
    vi.stubEnv("PUBLIC_PUSHER_CLUSTER", "ap1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    (window as any).location.pathname = "/";
  });

  it("應建立 Pusher 連線、訂閱頻道並綁定事件", async () => {
    setupDom();
    const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
    const { default: PusherMock } = await import("pusher-js");

    start();

    expect(PusherMock).toHaveBeenCalledWith("test-key", { cluster: "ap1" });
    expect(mockPusherSubscribe).toHaveBeenCalledWith("gmail-channel");
    for (const event of ["pusher:subscription_succeeded", "pusher:subscription_error", "new-email", "email-enriched", "sync-complete"]) {
      expect(bindMock).toHaveBeenCalledWith(event, expect.any(Function));
    }
  });

  it("重複呼叫不應重複建立 Pusher 實體", async () => {
    setupDom();
    const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
    const { default: PusherMock } = await import("pusher-js");

    start();
    start();

    expect(PusherMock).toHaveBeenCalledTimes(1);
  });

  it("connection-status 元素不存在時不應拋錯", async () => {
    vi.mocked(document.getElementById).mockReturnValue(null);
    const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
    expect(() => start()).not.toThrow();
  });

  it("subscription_succeeded / subscription_error 應更新連線狀態 UI", async () => {
    const { statusEl } = setupDom();
    const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
    start();

    const succeeded = findHandler("pusher:subscription_succeeded");
    succeeded?.();
    expect(statusEl.dataset.state).toBe("connected");
    expect(statusEl.dataset.tooltip).toBe("即時服務已連線");

    const failed = findHandler("pusher:subscription_error");
    failed?.();
    expect(statusEl.dataset.state).toBe("failed");
    expect(statusEl.dataset.tooltip).toBe("即時服務連線失敗");
  });

  describe("new-email 事件", () => {
    it("在首頁收到新信時應插入卡片並加上動畫 class", async () => {
      const { emailListEl } = setupDom();
      const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
      start();

      const handler = findHandler("new-email");
      handler?.(newEmailPayload);

      expect(mockBuildEmailRowElement).toHaveBeenCalledWith(newEmailPayload);
      const newEl = mockBuildEmailRowElement.mock.results[0].value;
      expect(newEl.classList.add).toHaveBeenCalledWith("email-row--new-pulse");
      expect(emailListEl.prepend).toHaveBeenCalledWith(newEl);
    });

    it("5 秒後應移除動畫 class", async () => {
      setupDom();
      const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
      start();

      vi.useFakeTimers();
      try {
        findHandler("new-email")?.(newEmailPayload);
        const newEl = mockBuildEmailRowElement.mock.results[0].value;
        vi.advanceTimersByTime(5000);
        expect(newEl.classList.remove).toHaveBeenCalledWith("email-row--new-pulse");
      } finally {
        vi.useRealTimers();
      }
    });

    it("非首頁時不應插入新信卡片", async () => {
      const { emailListEl } = setupDom();
      (window as any).location.pathname = "/unread";
      const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
      start();

      findHandler("new-email")?.(newEmailPayload);

      expect(mockBuildEmailRowElement).not.toHaveBeenCalled();
      expect(emailListEl.prepend).not.toHaveBeenCalled();
    });

    it("卡片已存在時不應重複插入", async () => {
      const { emailListEl } = setupDom({ existingRow: true });
      const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
      start();

      findHandler("new-email")?.(newEmailPayload);

      expect(mockBuildEmailRowElement).not.toHaveBeenCalled();
      expect(emailListEl.prepend).not.toHaveBeenCalled();
    });

    it("email-list 不存在時不應拋錯", async () => {
      setupDom();
      vi.mocked(document.getElementById).mockImplementation((id: string) =>
        id === "connection-status"
          ? { dataset: {}, setAttribute: vi.fn(), querySelector: vi.fn(() => null) } as any
          : null,
      );
      const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
      start();

      expect(() => findHandler("new-email")?.(newEmailPayload)).not.toThrow();
    });
  });

  describe("email-enriched 事件", () => {
    it("應更新重要樣式、分類 badge 與首次寄件者 badge", async () => {
      const { rowEl, linkEl } = setupDom({ existingRow: true });
      const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
      start();

      findHandler("email-enriched")?.({
        id: "msg-1",
        category: "primary",
        is_important: true,
        is_first_sender: true,
      });

      expect(rowEl.classList.add).toHaveBeenCalledWith("email-row--important");
      expect(rowEl.querySelector).toHaveBeenCalledWith(".email-link");
      expect(linkEl.querySelectorAll).toHaveBeenCalledWith(".badge.chip");

      // 兩個 badge：分類 + 首次寄件者
      expect(createdElements).toHaveLength(2);
      const [categoryBadge, firstSenderBadge] = createdElements;
      expect(categoryBadge.className).toBe("badge chip");
      expect(categoryBadge.textContent).toBe("主要");
      expect(categoryBadge.style.background).toContain("59,130,246");
      expect(firstSenderBadge.className).toBe("badge chip");
      expect(firstSenderBadge.textContent).toBe("首次寄件者");
      expect(firstSenderBadge.style.background).toContain("249,115,22");
      expect(linkEl.appendChild).toHaveBeenCalledTimes(2);
    });

    it("is_important 為 false 時應移除重要樣式且不建立 badge", async () => {
      const { rowEl, linkEl } = setupDom({ existingRow: true });
      const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
      start();

      findHandler("email-enriched")?.({
        id: "msg-1",
        category: null,
        is_important: false,
        is_first_sender: false,
      });

      expect(rowEl.classList.remove).toHaveBeenCalledWith("email-row--important");
      expect(rowEl.classList.add).not.toHaveBeenCalled();
      expect(linkEl.appendChild).not.toHaveBeenCalled();
      expect(createdElements).toHaveLength(0);
    });

    it.each([
      ["updates", "更新", "16,185,129"],
      ["promotions", "宣傳", "245,158,11"],
      ["social", "社群", "139,92,246"],
      ["forums", "論壇", "107,114,128"],
      ["custom", "custom", undefined],
    ])("分類 %s 應渲染對應 badge 文案與顏色", async (category, label, colorHint) => {
      setupDom({ existingRow: true });
      const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
      start();

      findHandler("email-enriched")?.({
        id: "msg-1",
        category: category as string,
        is_important: false,
        is_first_sender: false,
      });

      const badge = createdElements[0];
      expect(badge.textContent).toBe(label);
      if (colorHint) {
        expect(badge.style.background).toContain(colorHint);
      } else {
        // 未知名分類使用預設背景
        expect(badge.style.background).toBe("var(--color-bg-tertiary)");
      }
    });

    it("非首頁時應忽略 email-enriched", async () => {
      const { rowEl } = setupDom({ existingRow: true });
      (window as any).location.pathname = "/search";
      const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
      start();

      findHandler("email-enriched")?.({
        id: "msg-1",
        category: "primary",
        is_important: true,
        is_first_sender: false,
      });

      expect(rowEl.classList.add).not.toHaveBeenCalled();
      expect(rowEl.querySelector).not.toHaveBeenCalled();
    });

    it("對應 row 不存在時應忽略", async () => {
      setupDom(); // existingRow: false
      const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
      start();

      expect(() =>
        findHandler("email-enriched")?.({
          id: "msg-1",
          category: "primary",
          is_important: true,
          is_first_sender: false,
        }),
      ).not.toThrow();
    });

    it("清除舊 badge 時會先移除既有晶片", async () => {
      const oldBadge = { remove: vi.fn() };
      const { linkEl } = setupDom({ existingRow: true });
      vi.mocked(linkEl.querySelectorAll).mockReturnValue([oldBadge]);
      const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
      start();

      findHandler("email-enriched")?.({
        id: "msg-1",
        category: "primary",
        is_important: false,
        is_first_sender: false,
      });

      expect(oldBadge.remove).toHaveBeenCalled();
    });

    it("row 缺少 .email-link 時不應拋錯", async () => {
      setupDom({ existingRow: true });
      vi.mocked(document.querySelector).mockReturnValue({
        classList: { add: vi.fn(), remove: vi.fn() },
        querySelector: vi.fn(() => null),
      } as any);
      const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
      start();

      expect(() =>
        findHandler("email-enriched")?.({
          id: "msg-1",
          category: "primary",
          is_important: true,
          is_first_sender: true,
        }),
      ).not.toThrow();
      // 沒有 link 時不建立任何 badge
      expect(createdElements).toHaveLength(0);
    });
  });

  describe("sync-complete 事件", () => {
    it("已連線狀態下應更新同步完成標籤", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const { statusEl, statusLabelEl } = setupDom();
      const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
      start();

      findHandler("pusher:subscription_succeeded")?.();
      findHandler("sync-complete")?.({ last_history_id: "999", updated_at: "2026-08-01T10:00:00Z" });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("history_id=999"),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("2026-08-01T10:00:00Z"),
      );
      expect(statusEl.dataset.tooltip).toBe("即時服務已連線，郵件已同步");
      expect(statusEl.setAttribute).toHaveBeenCalledWith("aria-label", "即時服務已連線，郵件已同步");
      expect(statusLabelEl.textContent).toBe("即時服務已連線，郵件已同步");
      logSpy.mockRestore();
    });

    it("尚未連線成功時不應覆寫連線中標籤", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const { statusLabelEl } = setupDom();
      const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
      start();

      findHandler("sync-complete")?.({ last_history_id: "999", updated_at: "2026-08-01T10:00:00Z" });

      expect(statusLabelEl.textContent).toBe("即時服務連線中");
      logSpy.mockRestore();
    });

    it("connection-status 元素不存在時不應拋錯", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      setupDom();
      vi.mocked(document.getElementById).mockReturnValue(null);
      const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
      start();

      expect(() =>
        findHandler("sync-complete")?.({ last_history_id: "999", updated_at: "2026-08-01T10:00:00Z" }),
      ).not.toThrow();
      logSpy.mockRestore();
    });
  });
});

describe("DOM event listener", () => {
  it("應在模組載入時註冊 astro:page-load 事件", async () => {
    vi.resetModules();
    vi.clearAllMocks();
    await import("../lib/realtimeClient");

    expect(document.addEventListener).toHaveBeenCalledWith("astro:page-load", expect.any(Function));
  });
});
