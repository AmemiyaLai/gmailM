import { describe, it, expect } from "vitest";
import { parseEmailFilterParams, buildFilterHref } from "../lib/emailFilters";

describe("parseEmailFilterParams()", () => {
  it("無參數時應回傳預設值", () => {
    const url = new URL("https://example.com/emails");
    const result = parseEmailFilterParams(url);
    expect(result).toEqual({
      q: undefined,
      category: undefined,
      sender: undefined,
      recipient: undefined,
      from: undefined,
      to: undefined,
      unread: false,
      important: false,
      page: 1,
    });
  });

  it("應解析 q 搜尋參數", () => {
    const url = new URL("https://example.com/emails?q=test");
    const result = parseEmailFilterParams(url);
    expect(result.q).toBe("test");
  });

  it("應解析 category 參數", () => {
    const url = new URL("https://example.com/emails?category=devlog");
    const result = parseEmailFilterParams(url);
    expect(result.category).toBe("devlog");
  });

  it("應解析 sender 參數", () => {
    const url = new URL("https://example.com/emails?sender=test@example.com");
    const result = parseEmailFilterParams(url);
    expect(result.sender).toBe("test@example.com");
  });

  it("應解析 recipient 參數", () => {
    const url = new URL("https://example.com/emails?recipient=me@example.com");
    const result = parseEmailFilterParams(url);
    expect(result.recipient).toBe("me@example.com");
  });

  it("應解析 from 參數", () => {
    const url = new URL("https://example.com/emails?from=2026-01-01");
    const result = parseEmailFilterParams(url);
    expect(result.from).toBe("2026-01-01");
  });

  it("應解析 to 參數", () => {
    const url = new URL("https://example.com/emails?to=2026-12-31");
    const result = parseEmailFilterParams(url);
    expect(result.to).toBe("2026-12-31");
  });

  it("unread=1 應解析為 true", () => {
    const url = new URL("https://example.com/emails?unread=1");
    const result = parseEmailFilterParams(url);
    expect(result.unread).toBe(true);
  });

  it("unread=0 應解析為 false", () => {
    const url = new URL("https://example.com/emails?unread=0");
    const result = parseEmailFilterParams(url);
    expect(result.unread).toBe(false);
  });

  it("important=1 應解析為 true", () => {
    const url = new URL("https://example.com/emails?important=1");
    const result = parseEmailFilterParams(url);
    expect(result.important).toBe(true);
  });

  it("應解析 page 參數", () => {
    const url = new URL("https://example.com/emails?page=3");
    const result = parseEmailFilterParams(url);
    expect(result.page).toBe(3);
  });

  it("page=0 應被限制為 1", () => {
    const url = new URL("https://example.com/emails?page=0");
    const result = parseEmailFilterParams(url);
    expect(result.page).toBe(1);
  });

  it("page=-5 應被限制為 1", () => {
    const url = new URL("https://example.com/emails?page=-5");
    const result = parseEmailFilterParams(url);
    expect(result.page).toBe(1);
  });

  it("page=abc (NaN) 應回傳 1", () => {
    const url = new URL("https://example.com/emails?page=abc");
    const result = parseEmailFilterParams(url);
    expect(result.page).toBe(1);
  });

  it("空白字串值應被 trim 為 undefined", () => {
    const url = new URL("https://example.com/emails?q=+&category=+");
    const result = parseEmailFilterParams(url);
    expect(result.q).toBeUndefined();
    expect(result.category).toBeUndefined();
  });

  it("應同時解析所有參數", () => {
    const url = new URL(
      "https://example.com/emails?q=test&category=devlog&sender=a@b.com&recipient=c@d.com&from=2026-01-01&to=2026-12-31&unread=1&important=1&page=2",
    );
    const result = parseEmailFilterParams(url);
    expect(result.q).toBe("test");
    expect(result.category).toBe("devlog");
    expect(result.sender).toBe("a@b.com");
    expect(result.recipient).toBe("c@d.com");
    expect(result.from).toBe("2026-01-01");
    expect(result.to).toBe("2026-12-31");
    expect(result.unread).toBe(true);
    expect(result.important).toBe(true);
    expect(result.page).toBe(2);
  });
});

describe("buildFilterHref()", () => {
  it("無參數時應回傳 basePath", () => {
    expect(buildFilterHref("/emails", {})).toBe("/emails");
  });

  it("page=1 不應出現在 URL 中", () => {
    expect(buildFilterHref("/emails", { page: 1 })).toBe("/emails");
  });

  it("page>1 應出現在 URL 中", () => {
    const href = buildFilterHref("/emails", { page: 3 });
    expect(href).toBe("/emails?page=3");
  });

  it("應序列化 q 參數", () => {
    const href = buildFilterHref("/emails", { q: "hello world" });
    expect(href).toBe("/emails?q=hello+world");
  });

  it("應序列化 category 參數", () => {
    const href = buildFilterHref("/emails", { category: "devlog" });
    expect(href).toBe("/emails?category=devlog");
  });

  it("應序列化 sender 參數", () => {
    const href = buildFilterHref("/emails", { sender: "test@example.com" });
    expect(href).toBe("/emails?sender=test%40example.com");
  });

  it("應序列化 recipient 參數", () => {
    const href = buildFilterHref("/emails", { recipient: "me@example.com" });
    expect(href).toBe("/emails?recipient=me%40example.com");
  });

  it("應序列化 from 參數", () => {
    const href = buildFilterHref("/emails", { from: "2026-01-01" });
    expect(href).toBe("/emails?from=2026-01-01");
  });

  it("應序列化 to 參數", () => {
    const href = buildFilterHref("/emails", { to: "2026-12-31" });
    expect(href).toBe("/emails?to=2026-12-31");
  });

  it("unread=true 應序列化為 unread=1", () => {
    const href = buildFilterHref("/emails", { unread: true });
    expect(href).toBe("/emails?unread=1");
  });

  it("important=true 應序列化為 important=1", () => {
    const href = buildFilterHref("/emails", { important: true });
    expect(href).toBe("/emails?important=1");
  });

  it("unread=false 不應出現在 URL 中", () => {
    const href = buildFilterHref("/emails", { unread: false });
    expect(href).toBe("/emails");
  });

  it("important=false 不應出現在 URL 中", () => {
    const href = buildFilterHref("/emails", { important: false });
    expect(href).toBe("/emails");
  });

  it("應正確序列化所有參數", () => {
    const href = buildFilterHref("/emails", {
      q: "test",
      category: "devlog",
      sender: "a@b.com",
      unread: true,
      page: 2,
    });
    expect(href).toContain("/emails?");
    expect(href).toContain("q=test");
    expect(href).toContain("category=devlog");
    expect(href).toContain("sender=a%40b.com");
    expect(href).toContain("unread=1");
    expect(href).toContain("page=2");
  });

  it("應使用提供的 basePath", () => {
    const href = buildFilterHref("/unread", { q: "hi" });
    expect(href).toBe("/unread?q=hi");
  });
});
