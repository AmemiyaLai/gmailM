import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDeliverFirstSenderNotification, mockGetSupabase } = vi.hoisted(() => ({
  mockDeliverFirstSenderNotification: vi.fn().mockResolvedValue(true),
  mockGetSupabase: vi.fn(),
}));

vi.mock("../../../lib/supabase", () => ({
  getSupabase: mockGetSupabase,
}));

vi.mock("../../../lib/firstSender", () => ({
  deliverFirstSenderNotification: mockDeliverFirstSenderNotification,
}));

import { GET } from "../../../pages/api/gmail/first-sender-retry";

function makeContext(authHeader?: string) {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  const request = new Request("http://localhost/api/gmail/first-sender-retry", { headers });
  return { request } as never;
}

function setupSupabase(rows: unknown[] = []) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  mockGetSupabase.mockReturnValue({ from: vi.fn(() => chain) } as never);
}

describe("GET /api/gmail/first-sender-retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
  });

  it("無 Authorization header 應回傳 401", async () => {
    const res = await GET(makeContext());
    expect(res.status).toBe(401);
  });

  it("Authorization 不符時應回傳 401", async () => {
    const res = await GET(makeContext("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("無待重試事件時應回傳 0 sent", async () => {
    setupSupabase([]);
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attempted).toBe(0);
    expect(body.sent).toBe(0);
  });

  it("有待重試事件時應嘗試發送通知", async () => {
    const rows = [
      {
        sender_address: "a@test.com",
        first_email_id: "1",
        sender_display: "A",
        first_received_at: "2026-01-01",
        source: "live",
        notification_status: "pending",
        notification_attempts: 0,
        last_notification_error: null,
        notified_at: null,
        emails: {
          thread_id: "t1",
          sender: "A <a@test.com>",
          subject: "Hello",
          snippet: "Hi",
          received_at: "2026-01-01T00:00:00Z",
          category: "devlog",
          labels: ["INBOX"],
        },
      },
    ];
    setupSupabase(rows);
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(mockDeliverFirstSenderNotification).toHaveBeenCalled();
    const body = await res.json();
    expect(body.sent).toBe(1);
  });

  it("emails 為 null 的事件應被跳過", async () => {
    const rows = [
      {
        sender_address: "a@test.com",
        first_email_id: "1",
        sender_display: "A",
        first_received_at: "2026-01-01",
        source: "live",
        notification_status: "pending",
        notification_attempts: 0,
        last_notification_error: null,
        notified_at: null,
        emails: null,
      },
    ];
    setupSupabase(rows);
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(mockDeliverFirstSenderNotification).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.attempted).toBe(1);
    expect(body.sent).toBe(0);
  });

  it("deliverFirstSenderNotification 回傳 false 時 sent 不應增加", async () => {
    mockDeliverFirstSenderNotification.mockResolvedValueOnce(false);
    const rows = [
      {
        sender_address: "a@test.com",
        first_email_id: "1",
        sender_display: "A",
        first_received_at: "2026-01-01",
        source: "live",
        notification_status: "pending",
        notification_attempts: 0,
        last_notification_error: null,
        notified_at: null,
        emails: {
          thread_id: "t1",
          sender: "A <a@test.com>",
          subject: "Hello",
          snippet: "Hi",
          received_at: "2026-01-01T00:00:00Z",
          category: "devlog",
          labels: ["INBOX"],
        },
      },
    ];
    setupSupabase(rows);
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attempted).toBe(1);
    expect(body.sent).toBe(0);
  });

  it("DB 錯誤時應回傳 500", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } }),
    };
    mockGetSupabase.mockReturnValue({ from: vi.fn(() => chain) } as never);
    const res = await GET(makeContext("Bearer test-secret"));
    expect(res.status).toBe(500);
  });
});

