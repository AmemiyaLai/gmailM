import { describe, expect, it } from "vitest";
import { buildEmailAnalytics, parseAnalyticsRange, rangeToQueryBounds } from "../lib/emailAnalytics";

const emails = [
  { sender: "Alpha <alpha@example.com>", received_at: "2026-07-25T16:30:00Z", category: "devlog", is_read: false, is_important: true, subject: "部署完成 Release", snippet: "The release is ready", body_plain: "部署完成，請查看 dashboard" },
  { sender: "Alpha <alpha@example.com>", received_at: "2026-07-26T02:15:00Z", category: "devlog", is_read: true, is_important: false, subject: "Release update", snippet: "deployment status", body_plain: null },
  { sender: "Beta <beta@example.com>", received_at: "2026-07-26T08:00:00Z", category: "newsletter", is_read: true, is_important: false, subject: "Newsletter design", snippet: "https://example.com design trends", body_plain: "設計趨勢分享" },
];

describe("email analytics", () => {
  it("以台北時間統計日、時段、星期與寄件者日均", () => {
    const result = buildEmailAnalytics(emails, { preset: "custom", from: "2026-07-26", to: "2026-07-26" });
    expect(result.summary.total).toBe(3);
    expect(result.summary.unread).toBe(1);
    expect(result.summary.dailyAverage).toBe(3);
    expect(result.hours.find((item) => item.label === "00:00")?.count).toBe(1);
    expect(result.hours.find((item) => item.label === "10:00")?.count).toBe(1);
    expect(result.weekdays.find((item) => item.label === "週日")?.count).toBe(3);
    expect(result.senders[0]).toMatchObject({ sender: "Alpha <alpha@example.com>", count: 2, dailyAverage: 2 });
  });

  it("超過 90 天時改為月趨勢，並保留分類與關鍵詞", () => {
    const result = buildEmailAnalytics(emails, { preset: "custom", from: "2026-01-01", to: "2026-04-01" });
    expect(result.trend.bucket).toBe("month");
    expect(result.categories).toEqual(expect.arrayContaining([{ label: "devlog", count: 2 }]));
    expect(result.keywords.map((item) => item.label)).toContain("release");
    expect(result.keywords.map((item) => item.label)).not.toContain("https");
  });

  it("自訂範圍無效時回退全期間，快捷範圍含今天", () => {
    const invalid = parseAnalyticsRange(new URL("https://example.test/analytics?range=custom&from=2026-07-30&to=2026-07-01"));
    expect(invalid).toEqual({ preset: "all" });
    const recent = parseAnalyticsRange(new URL("https://example.test/analytics?range=7d"), new Date("2026-07-26T12:00:00+08:00"));
    expect(recent).toEqual({ preset: "7d", from: "2026-07-20", to: "2026-07-26" });
  });

  it("查詢界限覆蓋自訂結束日完整台北曆日", () => {
    expect(rangeToQueryBounds({ preset: "custom", from: "2026-07-01", to: "2026-07-31" })).toEqual({ from: "2026-07-01T00:00:00+08:00", to: "2026-08-01T00:00:00+08:00" });
  });
});
