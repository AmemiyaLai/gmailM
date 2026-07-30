import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initInboundAliasEditor } from "../lib/inboundListClient";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

interface MockButton {
  disabled: boolean;
  textContent: string | null;
  closest: (selector: string) => unknown;
}

function createEditor(options: { alias?: string; label?: string; site?: string } = {}) {
  const { alias = "blog", label = "部落格", site = "blog.example.com" } = options;

  const row = {
    dataset: { alias },
    querySelector: vi.fn((selector: string) => {
      if (selector.includes("label")) return { value: label };
      if (selector.includes("site")) return { value: site };
      return null;
    }),
  };

  const button: MockButton = {
    disabled: false,
    textContent: "儲存",
    closest: vi.fn((selector: string) => (selector === "[data-alias]" ? row : null)),
  };

  const target = {
    closest: vi.fn((selector: string) => (selector === "[data-action='save-alias']" ? button : null)),
  };

  const listeners: Record<string, ((e: unknown) => Promise<void> | void)[]> = {};
  const root = {
    dataset: {} as Record<string, string>,
    addEventListener: vi.fn((event: string, fn: (e: unknown) => void) => {
      (listeners[event] ??= []).push(fn);
    }),
  };

  initInboundAliasEditor(root as unknown as HTMLElement);

  const click = async () => {
    for (const fn of listeners.click ?? []) {
      await fn({ target });
    }
  };

  return { root, row, button, click };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("initInboundAliasEditor", () => {
  it("點擊儲存按鈕時送出 POST /api/inbound/alias", async () => {
    const { click } = createEditor();

    await click();

    expect(fetchMock).toHaveBeenCalledWith("/api/inbound/alias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias: "blog", label: "部落格", site: "blog.example.com" }),
    });
  });

  it("成功時顯示「已儲存」並在延遲後還原文字", async () => {
    const { button, click } = createEditor();

    await click();

    expect(button.textContent).toBe("已儲存");
    expect(button.disabled).toBe(false);

    vi.advanceTimersByTime(2_000);
    expect(button.textContent).toBe("儲存");
  });

  it("API 回應失敗時顯示「儲存失敗」", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { button, click } = createEditor();

    await click();

    expect(button.textContent).toBe("儲存失敗");
    errorSpy.mockRestore();
  });

  it("fetch 拋出例外時顯示「儲存失敗」且不外拋", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { button, click } = createEditor();

    await expect(click()).resolves.toBeUndefined();
    expect(button.textContent).toBe("儲存失敗");
    errorSpy.mockRestore();
  });

  it("重複初始化同一 root 不會重複掛 listener", () => {
    const { root } = createEditor();
    initInboundAliasEditor(root as unknown as HTMLElement);
    expect(root.addEventListener).toHaveBeenCalledTimes(1);
  });

  it("點擊非儲存按鈕的區域不觸發 fetch", async () => {
    const listeners: ((e: unknown) => Promise<void> | void)[] = [];
    const root = {
      dataset: {} as Record<string, string>,
      addEventListener: vi.fn((_: string, fn: (e: unknown) => void) => listeners.push(fn)),
    };
    initInboundAliasEditor(root as unknown as HTMLElement);

    for (const fn of listeners) {
      await fn({ target: { closest: () => null } });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
