import { describe, expect, it, vi, beforeEach } from "vitest";
import { registerFirstSender, deliverFirstSenderNotification } from "../lib/firstSender";

vi.mock("../lib/discord", () => ({
  sendFirstSenderDiscordNotification: vi.fn().mockResolvedValue(undefined),
}));

import { sendFirstSenderDiscordNotification } from "../lib/discord";

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

  it("非 23505 的資料庫錯誤應向外拋出", async () => {
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: null, error: { code: "42P01", message: "relation does not exist" } }),
      }),
    });
    const supabase = { from: vi.fn().mockReturnValue({ insert }) };
    await expect(registerFirstSender(supabase, baseEvent)).rejects.toThrow();
  });
});

describe("deliverFirstSenderNotification()", () => {
  const event = {
    sender_address: "alice@example.com",
    first_email_id: "msg-1",
    sender_display: "Alice <alice@example.com>",
    first_received_at: "2026-07-26T08:00:00.000Z",
    source: "live" as const,
    notification_status: "pending" as const,
    notification_attempts: 0,
    last_notification_error: null,
    notified_at: null,
  };

  const email = {
    threadId: "thread-1",
    sender: "Alice <alice@example.com>",
    subject: "Test Subject",
    snippet: "Test snippet",
    receivedAt: new Date("2026-07-26T08:00:00Z"),
    category: "system",
    labels: [],
    senderAddress: "alice@example.com",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendFirstSenderDiscordNotification).mockResolvedValue(undefined);
  });

  it("成功發送通知應回傳 true 並更新狀態為 sent", async () => {
    const updateMock = vi.fn().mockResolvedValue({ error: null });
    const eqMock = vi.fn().mockReturnValue({ error: null });
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockImplementation((data: unknown) => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      }),
    };

    const result = await deliverFirstSenderNotification(mockSupabase, event, email);
    expect(result).toBe(true);
    expect(sendFirstSenderDiscordNotification).toHaveBeenCalledWith(email);
  });

  it("Discord 發送失敗應回傳 false 並更新狀態為 failed", async () => {
    vi.mocked(sendFirstSenderDiscordNotification).mockRejectedValue(new Error("Discord API error"));
    const updateMock = vi.fn().mockResolvedValue({ error: null });
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockImplementation(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      }),
    };

    const result = await deliverFirstSenderNotification(mockSupabase, event, email);
    expect(result).toBe(false);
  });

  it("notification_attempts 應正確遞增", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockImplementation((data: { notification_attempts?: number }) => ({
          eq: vi.fn().mockImplementation((_col: string, _val: unknown) => {
            expect(data.notification_attempts).toBe(4);
            return Promise.resolve({ error: null });
          }),
        })),
      }),
    };

    const result = await deliverFirstSenderNotification(mockSupabase, { ...event, notification_attempts: 3 }, email);
    expect(result).toBe(true);
  });

  it("Discord 失敗時應記錄錯誤訊息", async () => {
    vi.mocked(sendFirstSenderDiscordNotification).mockRejectedValue(new Error("Network timeout"));
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockImplementation(() => ({
          eq: vi.fn().mockImplementation((_col: string, _val: unknown) => {
            return Promise.resolve({ error: null });
          }),
        })),
      }),
    };

    const result = await deliverFirstSenderNotification(mockSupabase, event, email);
    expect(result).toBe(false);
    expect(sendFirstSenderDiscordNotification).toHaveBeenCalled();
  });

  it("當更新 sent 狀態發生 DB 錯誤時應 capture 例外並標記為 failed", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockImplementation((data: { notification_status?: string }) => ({
          eq: vi.fn().mockImplementation((_col: string, _val: unknown) => {
            if (data.notification_status === "sent") {
              return Promise.resolve({ error: { message: "db update failed" } });
            }
            return Promise.resolve({ error: null });
          }),
        })),
      }),
    };

    const result = await deliverFirstSenderNotification(mockSupabase, event, email);
    expect(result).toBe(false);
  });
});

