import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  ilike: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
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
} from "../lib/emailQueries";

describe("emailQueries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.select.mockReturnThis();
    mockQuery.eq.mockReturnThis();
    mockQuery.ilike.mockReturnThis();
    mockQuery.gte.mockReturnThis();
    mockQuery.lte.mockReturnThis();
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
});
