import { describe, it, expect, vi, afterEach } from "vitest";
import { renderEmailRowHtml } from "../lib/emailCardHtml";

describe("renderEmailRowHtml()", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const baseData = {
    id: "msg-123",
    sender: "test@example.com",
    subject: "測試主旨",
    snippet: "這是一段摘要",
    received_at: "2026-07-26T08:00:00Z",
    category: null as string | null,
    is_important: false,
    is_starred: false,
  };

  it("應包含 checkbox input", () => {
    const html = renderEmailRowHtml(baseData);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("email-checkbox");
  });

  it("應包含 star 按鈕", () => {
    const html = renderEmailRowHtml(baseData);
    expect(html).toContain("star-btn");
    expect(html).toContain('aria-pressed="false"');
  });

  it("is_starred=true 時 aria-pressed 應為 true", () => {
    const html = renderEmailRowHtml({ ...baseData, is_starred: true });
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('fill="var(--color-warning)"');
  });

  it("is_starred=false 時 star 應為空心", () => {
    const html = renderEmailRowHtml({ ...baseData, is_starred: false });
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('fill="none"');
  });

  it("應包含 email 連結", () => {
    const html = renderEmailRowHtml(baseData);
    expect(html).toContain("/emails/msg-123");
    expect(html).toContain("email-link");
  });

  it("應顯示 sender", () => {
    const html = renderEmailRowHtml(baseData);
    expect(html).toContain("test@example.com");
  });

  it("應顯示 subject", () => {
    const html = renderEmailRowHtml(baseData);
    expect(html).toContain("測試主旨");
  });

  it("應顯示 snippet", () => {
    const html = renderEmailRowHtml(baseData);
    expect(html).toContain("這是一段摘要");
  });

  it("subject 為空時應顯示 (無主旨)", () => {
    const html = renderEmailRowHtml({ ...baseData, subject: "" });
    expect(html).toContain("(無主旨)");
  });

  it("snippet 為空時應處理", () => {
    const html = renderEmailRowHtml({ ...baseData, snippet: "" });
    expect(html).toContain("— ");
  });

  it("有 category 時應包含 badge", () => {
    const html = renderEmailRowHtml({ ...baseData, category: "devlog" });
    expect(html).toContain("badge");
    expect(html).toContain("開發日誌");
  });

  it("category 為 null 時不應包含 badge", () => {
    const html = renderEmailRowHtml({ ...baseData, category: null });
    expect(html).not.toContain("badge");
  });

  it("應包含 formatted date", () => {
    vi.useFakeTimers({ now: new Date("2026-07-26T12:00:00Z") });
    const html = renderEmailRowHtml(baseData);
    expect(html).toContain("email-date");
    expect(html).toContain('datetime="2026-07-26T08:00:00Z"');
  });

  it("應包含 action buttons (read/archive/trash)", () => {
    const html = renderEmailRowHtml(baseData);
    expect(html).toContain('data-action="read"');
    expect(html).toContain('data-action="archive"');
    expect(html).toContain('data-action="trash"');
  });

  it("應包含所有 action button 的 title", () => {
    const html = renderEmailRowHtml(baseData);
    expect(html).toContain("標示為已讀");
    expect(html).toContain("封存");
    expect(html).toContain("刪除");
  });
});
