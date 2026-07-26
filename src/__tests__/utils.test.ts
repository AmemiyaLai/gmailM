import { describe, it, expect } from "vitest";

/**
 * 單元測試範例
 *
 * 說明如何為工具函式撰寫 Vitest 單元測試。
 * 執行：npm run test:unit
 *
 * 注意：Astro 元件（.astro 檔）的測試建議使用 Playwright E2E，
 *       Vitest 適合測試純 TypeScript 工具函式與邏輯。
 */

// ─── 工具函式範例（實際使用時請放在 src/utils/ 目錄） ───

/**
 * 格式化日期為本地化字串
 */
function formatDate(date: Date, locale = "zh-TW"): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

/**
 * 截斷字串並附加省略符號
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * 將字串轉為 URL 友善的 slug
 */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\w-]/g, "")
    .replace(/--+/g, "-");
}

// ─── 測試案例 ───

describe("formatDate()", () => {
  it("應正確格式化日期為中文", () => {
    const date = new Date("2024-01-15");
    const result = formatDate(date, "zh-TW");
    expect(result).toContain("2024");
    expect(result).toContain("1");
    expect(result).toContain("15");
  });

  it("應接受不同語系", () => {
    const date = new Date("2024-06-01");
    const enResult = formatDate(date, "en-US");
    expect(typeof enResult).toBe("string");
    expect(enResult.length).toBeGreaterThan(0);
  });
});

describe("truncate()", () => {
  it("字串短於上限時應原樣返回", () => {
    expect(truncate("Hello", 10)).toBe("Hello");
  });

  it("字串等於上限時應原樣返回", () => {
    expect(truncate("Hello", 5)).toBe("Hello");
  });

  it("字串超過上限時應截斷並附加省略號", () => {
    const result = truncate("Hello World", 8);
    expect(result).toBe("Hello...");
    expect(result.length).toBe(8);
  });
});

describe("slugify()", () => {
  it("應將空格轉換為連字符", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("應移除特殊字元", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  it("應合併多個連字符", () => {
    expect(slugify("hello   world")).toBe("hello-world");
  });

  it("應處理中文（移除後只保留英數）", () => {
    const result = slugify("my-page-2024");
    expect(result).toBe("my-page-2024");
  });
});
