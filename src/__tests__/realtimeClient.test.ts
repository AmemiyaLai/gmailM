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
  const bindMock = vi.fn();
  return {
    mockPusherSubscribe: vi.fn(() => ({ bind: bindMock })),
    bindMock,
  };
});

vi.mock("pusher-js", () => ({ default: vi.fn().mockImplementation(function () { return { subscribe: mockPusherSubscribe }; }) }));

describe("startRealtimeConnection()", () => {
  beforeEach(() => {
    vi.stubEnv("PUBLIC_PUSHER_KEY", "test-key");
    vi.stubEnv("PUBLIC_PUSHER_CLUSTER", "ap1");
    bindMock.mockReset();
    mockPusherSubscribe.mockReset();
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

  it("重複呼叫不應重複建立 Pusher 實體", async () => {
    const { startRealtimeConnection: start } = await import("../lib/realtimeClient");
    const { default: PusherMock } = await import("pusher-js");

    start();
    start();

    expect(PusherMock).toHaveBeenCalledTimes(1);
  });
});

describe("DOM event listener", () => {
  it("應在模組載入時註冊 astro:page-load 事件", () => {
    expect(document.addEventListener).toHaveBeenCalledWith("astro:page-load", expect.any(Function));
  });
});
