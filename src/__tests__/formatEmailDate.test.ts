import { describe, it, expect, vi, afterEach } from "vitest";
import { formatEmailDate } from "../lib/formatEmailDate";

describe("formatEmailDate()", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("今日郵件應顯示時間（上午/下午）", () => {
    const now = new Date("2026-07-26T10:30:00Z");
    vi.useFakeTimers({ now });

    const result = formatEmailDate("2026-07-26T10:30:00Z");
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it("今日清晨郵件應顯示時間", () => {
    const now = new Date("2026-07-26T03:00:00Z");
    vi.useFakeTimers({ now });

    const result = formatEmailDate("2026-07-26T03:00:00Z");
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it("非今日郵件應顯示月/日格式", () => {
    const now = new Date("2026-07-26T12:00:00Z");
    vi.useFakeTimers({ now });

    const result = formatEmailDate("2026-07-20T08:00:00Z");
    expect(result).toMatch(/\d{1,2}月\s*\d{1,2}日/);
  });

  it("昨天的郵件應顯示月/日而非時間", () => {
    const now = new Date("2026-07-26T12:00:00Z");
    vi.useFakeTimers({ now });

    const result = formatEmailDate("2026-07-25T08:00:00Z");
    expect(result).toMatch(/\d{1,2}月\s*\d{1,2}日/);
  });

  it("跨日邊界：台北時區 23:59 收到的郵件在同日仍顯示時間", () => {
    const now = new Date("2026-07-26T15:59:00Z");
    vi.useFakeTimers({ now });

    const result = formatEmailDate("2026-07-26T15:30:00Z");
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it("跨日邊界：不同日期的郵件應顯示月/日", () => {
    const now = new Date("2026-07-26T16:00:00Z");
    vi.useFakeTimers({ now });

    const result = formatEmailDate("2026-07-25T16:00:00Z");
    expect(result).toMatch(/\d{1,2}月\s*\d{1,2}日/);
  });

  it("應回傳字串型別", () => {
    const now = new Date("2026-07-26T12:00:00Z");
    vi.useFakeTimers({ now });

    const result = formatEmailDate("2026-07-26T12:00:00Z");
    expect(typeof result).toBe("string");
  });
});
