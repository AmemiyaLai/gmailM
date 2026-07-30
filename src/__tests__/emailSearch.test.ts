import { describe, expect, it } from "vitest";
import {
  buildEmailSearchPatterns,
  escapeIlikeTerm,
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
});
