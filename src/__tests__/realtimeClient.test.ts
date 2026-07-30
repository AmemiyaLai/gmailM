import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  (globalThis as any).document = {
    getElementById: vi.fn(),
    addEventListener: vi.fn(),
  };
  (globalThis as any).window = {
    location: { pathname: "/" },
  };
});

const { mockPusherSubscribe, bindMock } = vi.hoisted(() => {
  const bindMock = vi.fn<(event: string, callback: (...args: any[]) => void) => void>();
  return {
    mockPusherSubscribe: vi.fn(() => ({ bind: bindMock })),
    bindMock,
  };
});

vi.mock("pusher-js", () => ({ default: vi.fn().mockImplementation(function () { return { subscribe: mockPusherSubscribe }; }) }));

describe("startRealtimeConnection()", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("PUBLIC_PUSHER_KEY", "test-key");
    vi.stubEnv("PUBLIC_PUSHER_CLUSTER", "ap1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("應建立 Pusher 連線、訂閱頻道並綁定事件", async () => {
    const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
    const { default: PusherMock } = await import("pusher-js");

    start();

    expect(PusherMock).toHaveBeenCalledWith("test-key", { cluster: "ap1" });
    expect(mockPusherSubscribe).toHaveBeenCalledWith("gmail-channel");
    expect(bindMock).toHaveBeenCalledWith("pusher:subscription_succeeded", expect.any(Function));
    expect(bindMock).toHaveBeenCalledWith("pusher:subscription_error", expect.any(Function));
    expect(bindMock).toHaveBeenCalledWith("new-email", expect.any(Function));
  });

  it("應以綠色連線 icon 或紅色未連線 icon 呈現狀態", async () => {
    const iconEl = { textContent: "" };
    const labelEl = { textContent: "" };
    const statusEl = {
      dataset: {} as Record<string, string>,
      title: "",
      setAttribute: vi.fn(),
      querySelector: vi.fn((selector: string) =>
        selector === "[data-connection-icon]" ? iconEl : labelEl),
    };
    vi.mocked(document.getElementById).mockReturnValue(statusEl as unknown as HTMLElement);

    const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
    start();

    expect(statusEl.dataset.state).toBe("connecting");
    expect(iconEl.textContent).toBe("wifi_off");

    const connectedHandler = bindMock.mock.calls.find(
      ([event]) => event === "pusher:subscription_succeeded",
    )?.[1];
    connectedHandler?.();

    expect(statusEl.dataset.state).toBe("connected");
    expect(statusEl.dataset.tooltip).toBe("即時服務已連線");
    expect(iconEl.textContent).toBe("wifi");
    expect(statusEl.setAttribute).toHaveBeenLastCalledWith("aria-label", "即時服務已連線");

    const failedHandler = bindMock.mock.calls.find(
      ([event]) => event === "pusher:subscription_error",
    )?.[1];
    failedHandler?.();

    expect(statusEl.dataset.state).toBe("failed");
    expect(statusEl.dataset.tooltip).toBe("即時服務連線失敗");
    expect(iconEl.textContent).toBe("wifi_off");
    expect(statusEl.setAttribute).toHaveBeenLastCalledWith("aria-label", "即時服務連線失敗");
  });

  it("重複呼叫不應重複建立 Pusher 實體", async () => {
    const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
    const { default: PusherMock } = await import("pusher-js");

    start();
    start();

    expect(PusherMock).toHaveBeenCalledTimes(1);
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
