import { describe, expect, it, vi, beforeEach } from "vitest";
import { registerFirstSender, sendFirstSenderDigest } from "../lib/firstSender";

vi.mock("../lib/discord", () => ({
  sendFirstSenderDigestNotification: vi.fn().mockResolvedValue(undefined),
  sendFirstSenderDiscordNotification: vi.fn().mockResolvedValue(undefined),
}));

import { sendFirstSenderDigestNotification } from "../lib/discord";

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

describe("sendFirstSenderDigest()", () => {
  const rows = [
    { sender_address: "alice@example.com", sender_display: "Alice <alice@example.com>", first_received_at: "2026-07-26T08:00:00.000Z" },
    { sender_address: "bob@example.com", sender_display: "Bob <bob@example.com>", first_received_at: "2026-07-26T09:00:00.000Z" },
  ];

  function makeSupabase(opts: {
    rows?: unknown[];
    selectError?: { message: string } | null;
    updateError?: { message: string } | null;
  } = {}) {
    const limit = vi.fn().mockResolvedValue({ data: opts.rows ?? [], error: opts.selectError ?? null });
    const selectChain = {
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit,
    };
    const select = vi.fn().mockReturnValue(selectChain);
    const updateIn = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
    const update = vi.fn().mockReturnValue({ in: updateIn });
    const supabase = { from: vi.fn().mockReturnValue({ select, update }) };
    return { supabase, selectChain, update, updateIn };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendFirstSenderDigestNotification).mockResolvedValue(undefined);
  });

  it("沒有待通知事件時不發送、回傳 pending 0", async () => {
    const { supabase, update } = makeSupabase({ rows: [] });
    const result = await sendFirstSenderDigest(supabase);
    expect(result).toEqual({ pending: 0, sent: false });
    expect(sendFirstSenderDigestNotification).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("只彙整 pending 與 failed 的事件", async () => {
    const { supabase, selectChain } = makeSupabase({ rows });
    await sendFirstSenderDigest(supabase);
    expect(selectChain.in).toHaveBeenCalledWith("notification_status", ["pending", "failed"]);
  });

  it("成功發送摘要後應將整批標記為 sent", async () => {
    const { supabase, update, updateIn } = makeSupabase({ rows });
    const result = await sendFirstSenderDigest(supabase);

    expect(result).toEqual({ pending: 2, sent: true });
    expect(sendFirstSenderDigestNotification).toHaveBeenCalledWith([
      { senderAddress: "alice@example.com", senderDisplay: "Alice <alice@example.com>", firstReceivedAt: "2026-07-26T08:00:00.000Z" },
      { senderAddress: "bob@example.com", senderDisplay: "Bob <bob@example.com>", firstReceivedAt: "2026-07-26T09:00:00.000Z" },
    ]);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ notification_status: "sent" }));
    expect(updateIn).toHaveBeenCalledWith("sender_address", ["alice@example.com", "bob@example.com"]);
  });

  it("Discord 發送失敗時應將整批標記為 failed 並記錄錯誤", async () => {
    vi.mocked(sendFirstSenderDigestNotification).mockRejectedValue(new Error("Discord webhook failed (500)"));
    const { supabase, update } = makeSupabase({ rows });
    const result = await sendFirstSenderDigest(supabase);

    expect(result).toEqual({ pending: 2, sent: false });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      notification_status: "failed",
      last_notification_error: "Discord webhook failed (500)",
    }));
  });

  it("Discord 已送出但回寫 sent 失敗時，不得標記為 failed（避免下次摘要重複通知）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase, update } = makeSupabase({ rows, updateError: { message: "db down" } });
    const result = await sendFirstSenderDigest(supabase);

    expect(result).toEqual({ pending: 2, sent: true });
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ notification_status: "failed" }));
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("查詢待通知事件失敗時應向外拋出", async () => {
    const { supabase } = makeSupabase({ selectError: { message: "select failed" } });
    await expect(sendFirstSenderDigest(supabase)).rejects.toEqual({ message: "select failed" });
  });
});
