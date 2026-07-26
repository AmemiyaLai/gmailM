import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTrigger = vi.fn().mockResolvedValue(undefined);
const PusherConstructor = vi.fn().mockImplementation(() => ({
  trigger: mockTrigger,
}));

vi.mock("pusher", () => ({
  default: PusherConstructor,
}));

import { getPusher } from "../../lib/pusher";

describe("getPusher()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("應建立 Pusher 實例並回傳", () => {
    const p = getPusher();
    expect(PusherConstructor).toHaveBeenCalled();
    expect(p).toBeDefined();
  });

  it("多次呼叫應回傳同一個實例（singleton）", () => {
    const a = getPusher();
    const b = getPusher();
    expect(a).toBe(b);
  });

  it("應使用 useTLS: true 建立 Pusher", () => {
    getPusher();
    expect(PusherConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        useTLS: true,
      }),
    );
  });

  it("trigger 應可正常呼叫", async () => {
    const p = getPusher();
    await p.trigger("channel", "event", { data: "test" });
    expect(mockTrigger).toHaveBeenCalledWith("channel", "event", { data: "test" });
  });
});
