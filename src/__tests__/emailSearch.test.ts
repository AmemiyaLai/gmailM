import { describe, expect, it } from "vitest";
import {
  buildEmailSearchFallbackFilters,
  buildEmailSearchPatterns,
  escapeIlikeTerm,
  isMissingEmailSearchTextColumn,
  parseEmailSearchTerms,
} from "../lib/emailSearch";

describe("emailSearch", () => {
  it("中文短詞應保留為子字串搜尋 pattern", () => {
    expect(buildEmailSearchPatterns("蝦皮")).toEqual(["%蝦皮%"]);
  });

  it("多個關鍵字應依空白拆分並全部建立 pattern", () => {
    expect(buildEmailSearchPatterns("  蝦皮　撥款  ")).toEqual(["%蝦皮%", "%撥款%"]);
  });

  it("應移除重複關鍵字但保留原始順序與大小寫", () => {
    expect(parseEmailSearchTerms("Shopee 蝦皮 Shopee")).toEqual(["Shopee", "蝦皮"]);
  });

  it("空白輸入應回傳空陣列", () => {
    expect(buildEmailSearchPatterns(" \t ")).toEqual([]);
  });

  it("應將 ILIKE 特殊字元與反斜線按字面轉義", () => {
    expect(escapeIlikeTerm(String.raw`100%_折扣\活動`)).toBe(String.raw`100\%\_折扣\\活動`);
  });

  it("fallback 應讓每個詞分別搜尋寄件者、主旨與摘要", () => {
    expect(buildEmailSearchFallbackFilters("蝦皮 撥款")).toEqual([
      'sender.ilike."%蝦皮%",subject.ilike."%蝦皮%",snippet.ilike."%蝦皮%"',
      'sender.ilike."%撥款%",subject.ilike."%撥款%",snippet.ilike."%撥款%"',
    ]);
  });

  it("fallback 應轉義 PostgREST 引號值", () => {
    const [filter] = buildEmailSearchFallbackFilters('折扣"活動');
    expect(filter).toBe(
      String.raw`sender.ilike."%折扣\"活動%",subject.ilike."%折扣\"活動%",snippet.ilike."%折扣\"活動%"`,
    );
  });

  it("只應把 search_text 欄位不存在辨識為可降級錯誤", () => {
    expect(
      isMissingEmailSearchTextColumn({
        code: "42703",
        message: "column emails.search_text does not exist",
      }),
    ).toBe(true);
    expect(
      isMissingEmailSearchTextColumn({
        code: "42703",
        message: "column emails.recipient does not exist",
      }),
    ).toBe(false);
    expect(
      isMissingEmailSearchTextColumn({
        code: "42501",
        message: "permission denied",
      }),
    ).toBe(false);
  });
});
