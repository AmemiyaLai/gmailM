import { describe, expect, it, vi } from "vitest";
import { registerFirstSender } from "../lib/firstSender";

const baseEvent = {
  sender_address: "alice@example.com",
  first_email_id: "msg-1",
  sender_display: "Alice <alice@example.com>",
  first_received_at: "2026-07-26T08:00:00.000Z",
  source: "live" as const,
};

describe("registerFirstSender()", () => {
  it("新地址會建立待通知事件", async () => {
    const single = vi.fn().mockResolvedValue({ data: { ...baseEvent, notification_status: "pending" }, error: null });
    const insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });
    const supabase = { from: vi.fn().mockReturnValue({ insert }) };
    const event = await registerFirstSender(supabase, baseEvent);
    expect(event?.notification_status).toBe("pending");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ notification_status: "pending" }));
  });

  it("唯一鍵衝突代表已處理過，不能再次通知", async () => {
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } }) }),
    });
    const supabase = { from: vi.fn().mockReturnValue({ insert }) };
    await expect(registerFirstSender(supabase, baseEvent)).resolves.toBeNull();
  });

  it("基線事件不進入 Discord 待發送佇列", async () => {
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } }) }),
    });
    const supabase = { from: vi.fn().mockReturnValue({ insert }) };
    await registerFirstSender(supabase, { ...baseEvent, source: "baseline" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ notification_status: "baseline" }));
  });
});
