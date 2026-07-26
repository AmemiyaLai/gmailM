import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  ilike: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  lt: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: null, error: null }),
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 }),
};

const mockFrom = vi.fn().mockReturnValue(mockQuery);

vi.mock("../lib/supabase", () => ({
  getSupabase: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import {
  getUnreadCount,
  getTodayCount,
  getCategoryCounts,
  getImportantEmails,
  getLatestSummary,
  listEmails,
  getSenderStats,
  getFirstSenderEvents,
  getSenderGroupUnreadCounts,
  listEmailsByGroup,
  getSenderGroupTopSenders,
  getAnalyticsEmails,
} from "../lib/emailQueries";

describe("emailQueries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.select.mockReturnThis();
    mockQuery.eq.mockReturnThis();
    mockQuery.ilike.mockReturnThis();
    mockQuery.gte.mockReturnThis();
    mockQuery.lte.mockReturnThis();
    mockQuery.lt.mockReturnThis();
    mockQuery.order.mockReturnThis();
    mockQuery.range.mockReturnThis();
    mockQuery.limit.mockReturnThis();
  });

  describe("getUnreadCount()", () => {
    it("應回傳未讀郵件數量", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 42 });

      const count = await getUnreadCount();
      expect(count).toBe(42);
    });

    it("count 為 null 時應回傳 0", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: null });

      const count = await getUnreadCount();
      expect(count).toBe(0);
    });
  });

  describe("getTodayCount()", () => {
    it("應回傳今日郵件數量", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 7 });

      const count = await getTodayCount();
      expect(count).toBe(7);
    });
  });

  describe("getCategoryCounts()", () => {
    it("應回傳所有類別的計數", async () => {
      let callIndex = 0;
      mockQuery.then = (resolve: (v: unknown) => void) => {
        const counts = [10, 5, 3, 20];
        resolve({ data: [], error: null, count: counts[callIndex++] ?? 0 });
      };

      const results = await getCategoryCounts();
      expect(results).toHaveLength(4);
      expect(results.map((r) => r.category)).toContain("devlog");
      expect(results.map((r) => r.category)).toContain("newsletter");
      expect(results.map((r) => r.category)).toContain("system");
      expect(results.map((r) => r.category)).toContain("uncategorized");
    });
  });

  describe("getImportantEmails()", () => {
    it("應回傳重要郵件列表", async () => {
      const mockRows = [
        {
          id: "1",
          sender: "a@example.com",
          subject: "Test",
          snippet: "n",
          received_at: "2026-07-26T08:00:00Z",
          is_read: false,
          category: "system",
          is_important: true,
          labels: ["STARRED"],
        },
      ];
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: mockRows, error: null, count: 0 });

      const emails = await getImportantEmails(5);
      expect(emails).toHaveLength(1);
      expect(emails[0].is_starred).toBe(true);
    });

    it("data 為 null 應回傳空陣列", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 0 });

      const emails = await getImportantEmails();
      expect(emails).toEqual([]);
    });
  });

  describe("getLatestSummary()", () => {
    it("應回傳最新摘要", async () => {
      const summary = {
        id: "s1",
        summary_text: "今日摘要",
        email_count: 10,
        period_start: "2026-07-26T00:00:00Z",
        period_end: "2026-07-26T23:59:59Z",
        created_at: "2026-07-26T12:00:00Z",
      };
      mockQuery.maybeSingle.mockResolvedValue({ data: summary, error: null });

      const result = await getLatestSummary();
      expect(result).not.toBeNull();
      expect(result!.summary_text).toBe("今日摘要");
    });

    it("無摘要時應回傳 null", async () => {
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });

      const result = await getLatestSummary();
      expect(result).toBeNull();
    });
  });

  describe("listEmails()", () => {
    it("無參數時應使用預設值查詢", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 });

      const result = await listEmails();
      expect(result.emails).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    it("onlyUnread=true 應加入 is_read=false 條件", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 });

      await listEmails({ onlyUnread: true });
      expect(mockQuery.eq).toHaveBeenCalledWith("is_read", false);
    });

    it("onlyImportant=true 應加入 is_important=true 條件", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 });

      await listEmails({ onlyImportant: true });
      expect(mockQuery.eq).toHaveBeenCalledWith("is_important", true);
    });

    it("category 應加入 category 條件", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 });

      await listEmails({ category: "devlog" });
      expect(mockQuery.eq).toHaveBeenCalledWith("category", "devlog");
    });

    it("sender 應使用 ilike 模糊搜尋", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 });

      await listEmails({ sender: "test" });
      expect(mockQuery.ilike).toHaveBeenCalledWith("sender", "%test%");
    });

    it("recipient 應使用 ilike 模糊搜尋", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 });

      await listEmails({ recipient: "me" });
      expect(mockQuery.ilike).toHaveBeenCalledWith("recipient", "%me%");
    });

    it("from 應使用 gte 條件", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 });

      await listEmails({ from: "2026-01-01" });
      expect(mockQuery.gte).toHaveBeenCalledWith(
        "received_at",
        expect.any(String),
      );
    });

    it("to 應使用 lte 條件", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 });

      await listEmails({ to: "2026-12-31" });
      expect(mockQuery.lte).toHaveBeenCalledWith(
        "received_at",
        expect.any(String),
      );
    });

    it("回傳超過 limit 時 hasMore 應為 true", async () => {
      const mockRows = Array.from({ length: 51 }, (_, i) => ({
        id: String(i),
        sender: "a@example.com",
        subject: "s",
        snippet: "n",
        received_at: "2026-07-26T08:00:00Z",
        is_read: false,
        category: null,
        labels: [],
      }));
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: mockRows, error: null, count: 0 });

      const result = await listEmails({ limit: 50 });
      expect(result.hasMore).toBe(true);
      expect(result.emails).toHaveLength(50);
    });

    it("is_starred 應從 labels 推導", async () => {
      const mockRows = [
        {
          id: "1",
          sender: "a@example.com",
          subject: "s",
          snippet: "n",
          received_at: "2026-07-26T08:00:00Z",
          is_read: false,
          category: null,
          labels: ["STARRED", "INBOX"],
        },
      ];
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: mockRows, error: null, count: 0 });

      const result = await listEmails();
      expect(result.emails[0].is_starred).toBe(true);
    });

    it("labels 為 null 時 is_starred 應為 false", async () => {
      const mockRows = [
        {
          id: "1",
          sender: "a@example.com",
          subject: "s",
          snippet: "n",
          received_at: "2026-07-26T08:00:00Z",
          is_read: false,
          category: null,
          labels: null,
        },
      ];
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: mockRows, error: null, count: 0 });

      const result = await listEmails();
      expect(result.emails[0].is_starred).toBe(false);
    });
  });

  describe("getSenderStats()", () => {
    it("應回傳發送者統計（已按 count 降序）", async () => {
      const mockRows = [
        { sender: "a@example.com", category: "devlog", received_at: "2026-07-26T08:00:00Z" },
        { sender: "a@example.com", category: "devlog", received_at: "2026-07-26T09:00:00Z" },
        { sender: "b@example.com", category: "system", received_at: "2026-07-26T07:00:00Z" },
        { sender: "b@example.com", category: "newsletter", received_at: "2026-07-26T10:00:00Z" },
        { sender: "b@example.com", category: "system", received_at: "2026-07-26T11:00:00Z" },
      ];
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: mockRows, error: null, count: 0 });

      const stats = await getSenderStats(2);
      expect(stats).toHaveLength(2);
      expect(stats[0].sender).toBe("b@example.com");
      expect(stats[0].count).toBe(3);
      expect(stats[1].sender).toBe("a@example.com");
      expect(stats[1].count).toBe(2);
    });

    it("低於 minCount 的發送者應被過濾", async () => {
      const mockRows = [
        { sender: "a@example.com", category: "devlog", received_at: "2026-07-26T08:00:00Z" },
      ];
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: mockRows, error: null, count: 0 });

      const stats = await getSenderStats(2);
      expect(stats).toHaveLength(0);
    });

    it("應追蹤多個分類", async () => {
      const mockRows = [
        { sender: "a@example.com", category: "devlog", received_at: "2026-07-26T08:00:00Z" },
        { sender: "a@example.com", category: "system", received_at: "2026-07-26T09:00:00Z" },
      ];
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: mockRows, error: null, count: 0 });

      const stats = await getSenderStats(2);
      expect(stats[0].categories).toContain("devlog");
      expect(stats[0].categories).toContain("system");
    });

    it("latestReceivedAt 應為最新的 received_at", async () => {
      const mockRows = [
        { sender: "a@example.com", category: "devlog", received_at: "2026-07-26T08:00:00Z" },
        { sender: "a@example.com", category: "devlog", received_at: "2026-07-26T10:00:00Z" },
      ];
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: mockRows, error: null, count: 0 });

      const stats = await getSenderStats(2);
      expect(stats[0].latestReceivedAt).toBe("2026-07-26T10:00:00Z");
    });

    it("data 為空時應回傳空陣列", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 0 });

      const stats = await getSenderStats();
      expect(stats).toEqual([]);
    });
  });

  describe("listEmails() offset 參數", () => {
    it("offset 應影響 range 呼叫", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 });

      await listEmails({ offset: 20, limit: 10 });
      expect(mockQuery.range).toHaveBeenCalledWith(20, 30);
    });
  });

  describe("getFirstSenderEvents()", () => {
    it("應回傳事件列表", async () => {
      const events = [
        {
          sender_address: "alice@example.com",
          first_email_id: "msg-1",
          sender_display: "Alice",
          first_received_at: "2026-07-26T08:00:00Z",
          source: "live",
          notification_status: "sent",
          notification_attempts: 1,
          last_notification_error: null,
          notified_at: "2026-07-26T08:01:00Z",
        },
      ];
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: events, error: null });

      const result = await getFirstSenderEvents();
      expect(result).toHaveLength(1);
      expect(result[0].sender_address).toBe("alice@example.com");
    });

    it("data 為 null 應回傳空陣列", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null });

      const result = await getFirstSenderEvents();
      expect(result).toEqual([]);
    });

    it("自訂 limit 參數", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null });

      await getFirstSenderEvents(10);
      expect(mockQuery.limit).toHaveBeenCalledWith(10);
    });
  });

  describe("getSenderGroupUnreadCounts()", () => {
    const mockGroups = [
      { id: "banking", label: "銀行", icon: "🏦", colorVar: "--color-success", patterns: ["bank", "esun"] },
      { id: "devtools", label: "開發", icon: "💻", colorVar: "--color-info", patterns: ["github", "gitlab"] },
      { id: "others", label: "其他", icon: "📦", colorVar: "--color-text-tertiary", patterns: [] },
    ];

    it("應回傳每個群組的未讀數量", async () => {
      const senders = [
        { sender: "esun@bank.com" },
        { sender: "esun@bank.com" },
        { sender: "noreply@github.com" },
        { sender: "random@example.com" },
      ];
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: senders, error: null });

      const result = await getSenderGroupUnreadCounts(mockGroups);
      expect(result.banking).toBe(2);
      expect(result.devtools).toBe(1);
      expect(result.others).toBe(1);
    });

    it("無未讀郵件時全部應為 0", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null });

      const result = await getSenderGroupUnreadCounts(mockGroups);
      expect(result.banking).toBe(0);
      expect(result.devtools).toBe(0);
      expect(result.others).toBe(0);
    });

    it("data 為 null 應回傳全 0", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null });

      const result = await getSenderGroupUnreadCounts(mockGroups);
      expect(result.others).toBe(0);
    });
  });

  describe("listEmailsByGroup()", () => {
    const mockGroups = [
      { id: "banking", label: "銀行", icon: "🏦", colorVar: "--color-success", patterns: ["bank", "esun"] },
      { id: "devtools", label: "開發", icon: "💻", colorVar: "--color-info", patterns: ["github"] },
      { id: "others", label: "其他", icon: "📦", colorVar: "--color-text-tertiary", patterns: [] },
    ];

    it("正常群組應回傳匹配的未讀郵件", async () => {
      const rows = [
        {
          id: "1", sender: "esun@bank.com", subject: "Bank Alert", snippet: "alert",
          received_at: "2026-07-26T08:00:00Z", is_read: false, category: null, labels: [],
        },
        {
          id: "2", sender: "noreply@github.com", subject: "GitHub", snippet: "notification",
          received_at: "2026-07-26T09:00:00Z", is_read: false, category: null, labels: [],
        },
      ];
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: rows, error: null });

      const result = await listEmailsByGroup(mockGroups, "banking");
      expect(result.emails).toHaveLength(1);
      expect(result.emails[0].sender).toBe("esun@bank.com");
    });

    it("「其他」群組應回傳不匹配任何群組的未讀郵件", async () => {
      const rows = [
        {
          id: "1", sender: "esun@bank.com", subject: "Bank", snippet: "alert",
          received_at: "2026-07-26T08:00:00Z", is_read: false, category: null, labels: [],
        },
        {
          id: "2", sender: "random@example.com", subject: "Hello", snippet: "hi",
          received_at: "2026-07-26T09:00:00Z", is_read: false, category: null, labels: [],
        },
      ];
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: rows, error: null });

      const result = await listEmailsByGroup(mockGroups, "others");
      expect(result.emails).toHaveLength(1);
      expect(result.emails[0].sender).toBe("random@example.com");
    });

    it("不存在的 groupId 應回傳空陣列", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null });

      const result = await listEmailsByGroup(mockGroups, "nonexistent");
      expect(result.emails).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    it("hasMore 應正確判斷", async () => {
      // 建立 3 封匹配的郵件，但 limit=2
      const rows = Array.from({ length: 3 }, (_, i) => ({
        id: String(i), sender: "esun@bank.com", subject: "s", snippet: "n",
        received_at: `2026-07-26T0${8 + i}:00:00Z`, is_read: false, category: null, labels: [],
      }));
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: rows, error: null });

      const result = await listEmailsByGroup(mockGroups, "banking", { limit: 2 });
      expect(result.hasMore).toBe(true);
      expect(result.emails).toHaveLength(2);
    });
  });

  describe("getSenderGroupTopSenders()", () => {
    const mockGroups = [
      { id: "banking", label: "銀行", icon: "🏦", colorVar: "--color-success", patterns: ["bank"] },
      { id: "others", label: "其他", icon: "📦", colorVar: "--color-text-tertiary", patterns: [] },
    ];

    it("應回傳每個群組中前 N 名寄件者", async () => {
      const rows = [
        { sender: "alice@bank.com" },
        { sender: "alice@bank.com" },
        { sender: "alice@bank.com" },
        { sender: "bob@bank.com" },
        { sender: "bob@bank.com" },
        { sender: "random@example.com" },
      ];
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: rows, error: null });

      const result = await getSenderGroupTopSenders(mockGroups, 3);
      expect(result.banking).toHaveLength(2);
      expect(result.banking[0].sender).toBe("alice@bank.com");
      expect(result.banking[0].count).toBe(3);
      expect(result.banking[1].sender).toBe("bob@bank.com");
      expect(result.banking[1].count).toBe(2);
    });

    it("「其他」群組應回傳不匹配的 top 寄件者", async () => {
      const rows = [
        { sender: "random@example.com" },
        { sender: "random@example.com" },
        { sender: "other@test.com" },
      ];
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: rows, error: null });

      const result = await getSenderGroupTopSenders(mockGroups, 3);
      expect(result.others).toHaveLength(2);
      expect(result.others[0].sender).toBe("random@example.com");
      expect(result.others[0].count).toBe(2);
    });

    it("預設 topN 應為 3", async () => {
      const rows = Array.from({ length: 10 }, (_, i) => ({
        sender: `user${i}@bank.com`,
      }));
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: rows, error: null });

      const result = await getSenderGroupTopSenders(mockGroups);
      expect(result.banking.length).toBeLessThanOrEqual(3);
    });
  });

  describe("getAnalyticsEmails()", () => {
    it("應分頁讀取所有郵件", async () => {
      let callCount = 0;
      mockQuery.then = (resolve: (v: unknown) => void) => {
        callCount++;
        if (callCount === 1) {
          resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ sender: `a${i}@test.com`, received_at: "2026-07-26T00:00:00Z", category: null, is_read: false, is_important: false, subject: "s", snippet: "n", body_plain: "" })), error: null });
        } else {
          resolve({ data: [{ sender: "a@test.com", received_at: "2026-07-26T01:00:00Z", category: null, is_read: false, is_important: false, subject: "s", snippet: "n", body_plain: "" }], error: null });
        }
      };

      const result = await getAnalyticsEmails({ from: "2026-07-25", to: "2026-07-27" });
      expect(result.length).toBeGreaterThanOrEqual(1000);
    });

    it("空範圍應回傳空陣列", async () => {
      mockQuery.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null });

      const result = await getAnalyticsEmails({ from: "2026-07-25", to: "2026-07-26" });
      expect(result).toEqual([]);
    });
  });
});
