import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { renderEmailRowHtml, buildEmailRowElement } from "../lib/emailCardHtml";

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

  it("is_starred=true 時 aria-pressed 應為 true 且星號有 starred class", () => {
    const html = renderEmailRowHtml({ ...baseData, is_starred: true });
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("star-icon starred");
  });

  it("is_starred=false 時 aria-pressed 應為 false 且星號無 starred class", () => {
    const html = renderEmailRowHtml({ ...baseData, is_starred: false });
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('class="material-symbols-rounded email-action-icon star-icon"');
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

  it("is_first_sender=true 時應包含首次寄件者 badge", () => {
    const html = renderEmailRowHtml({ ...baseData, is_first_sender: true });
    expect(html).toContain("首次寄件者");
    expect(html).toContain("badge");
  });

  it("is_first_sender=false 時不應包含首次寄件者 badge", () => {
    const html = renderEmailRowHtml({ ...baseData, is_first_sender: false });
    expect(html).not.toContain("首次寄件者");
  });

  it("is_first_sender 為 undefined 時不應包含首次寄件者 badge", () => {
    const html = renderEmailRowHtml(baseData);
    expect(html).not.toContain("首次寄件者");
  });

  it("is_important=true 時應渲染（透過 buildEmailRowElement）", () => {
    const html = renderEmailRowHtml({ ...baseData, is_important: true });
    expect(html).toContain("email-date");
  });
});

describe("buildEmailRowElement()", () => {
  const originalDocument = globalThis.document;

  beforeAll(() => {
    // Provide minimal DOM mock for node environment
    const doc = {
      createElement: vi.fn().mockImplementation(() => {
        const classes = new Set<string>();
        return {
          tagName: "DIV",
          className: "",
          dataset: {} as Record<string, string>,
          classList: {
            add(c: string) { classes.add(c); },
            contains(c: string) { return classes.has(c); },
          },
          innerHTML: "",
        };
      }),
    };
    globalThis.document = doc as unknown as Document;
  });

  afterAll(() => {
    globalThis.document = originalDocument;
  });

  const baseData = {
    id: "msg-456",
    sender: "test@example.com",
    subject: "測試主旨",
    snippet: "這是一段摘要",
    received_at: "2026-07-26T08:00:00Z",
    category: null as string | null,
    is_important: false,
    is_starred: false,
  };

  it("應回傳正確的元素標籤名和 className", () => {
    const el = buildEmailRowElement(baseData);
    expect(el.tagName).toBe("DIV");
    expect(el.className).toContain("email-row");
    expect(el.className).toContain("email-row--unread");
  });

  it("應設定正確的 data-id 屬性", () => {
    const el = buildEmailRowElement(baseData);
    expect(el.dataset.id).toBe("msg-456");
  });

  it("應設定 data-read 為 false", () => {
    const el = buildEmailRowElement(baseData);
    expect(el.dataset.read).toBe("false");
  });

  it("應設定 data-starred 為 false", () => {
    const el = buildEmailRowElement(baseData);
    expect(el.dataset.starred).toBe("false");
  });

  it("is_starred=true 時 data-starred 應為 true", () => {
    const el = buildEmailRowElement({ ...baseData, is_starred: true });
    expect(el.dataset.starred).toBe("true");
  });

  it("is_important=true 應加入 email-row--important class", () => {
    const el = buildEmailRowElement({ ...baseData, is_important: true });
    expect(el.classList.contains("email-row--important")).toBe(true);
  });

  it("is_important=false 不應加入 email-row--important class", () => {
    const el = buildEmailRowElement({ ...baseData, is_important: false });
    expect(el.classList.contains("email-row--important")).toBe(false);
  });

  it("is_important=undefined 不應加入 email-row--important class", () => {
    const el = buildEmailRowElement(baseData);
    expect(el.classList.contains("email-row--important")).toBe(false);
  });

  it("innerHTML 應包含 renderEmailRowHtml 的內容", () => {
    const el = buildEmailRowElement(baseData);
    expect(el.innerHTML).toContain("test@example.com");
    expect(el.innerHTML).toContain("測試主旨");
    expect(el.innerHTML).toContain("email-link");
  });

  it("應包含 checkbox、star 按鈕和 action 按鈕", () => {
    const el = buildEmailRowElement(baseData);
    expect(el.innerHTML).toContain("email-checkbox");
    expect(el.innerHTML).toContain("star-btn");
    expect(el.innerHTML).toContain('data-action="read"');
    expect(el.innerHTML).toContain('data-action="archive"');
    expect(el.innerHTML).toContain('data-action="trash"');
  });
});
