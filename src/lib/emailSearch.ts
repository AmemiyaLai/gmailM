const SEARCH_TERM_SEPARATOR = /\s+/u;
const ILIKE_SPECIAL_CHARACTERS = /[\\%_]/gu;
const POSTGREST_QUOTED_VALUE_CHARACTERS = /[\\"]/gu;
const SEARCH_COLUMNS = ["sender", "subject", "snippet"] as const;

/**
 * 將使用者輸入拆成需全部命中的搜尋詞。
 * 重複詞不必對資料庫套用相同條件多次。
 */
export function parseEmailSearchTerms(input: string): string[] {
  return [...new Set(input.trim().split(SEARCH_TERM_SEPARATOR).filter(Boolean))];
}

/** 將 PostgreSQL ILIKE 萬用字元轉義，讓使用者輸入按字面比對。 */
export function escapeIlikeTerm(term: string): string {
  return term.replace(ILIKE_SPECIAL_CHARACTERS, "\\$&");
}

/** 建立供 Supabase `.ilike()` 使用的子字串搜尋 pattern。 */
export function buildEmailSearchPatterns(input: string): string[] {
  return parseEmailSearchTerms(input).map((term) => `%${escapeIlikeTerm(term)}%`);
}

/**
 * 建立不依賴 generated search_text 欄位的 PostgREST OR 條件。
 * 多組條件依序套用 `.or()` 時，仍維持「所有搜尋詞皆須命中」。
 */
export function buildEmailSearchFallbackFilters(input: string): string[] {
  return buildEmailSearchPatterns(input).map((pattern) => {
    const quotedPattern = `"${pattern.replace(
      POSTGREST_QUOTED_VALUE_CHARACTERS,
      "\\$&",
    )}"`;
    return SEARCH_COLUMNS
      .map((column) => `${column}.ilike.${quotedPattern}`)
      .join(",");
  });
}

/** 判斷查詢是否只因 search_text migration 尚未套用而失敗。 */
export function isMissingEmailSearchTextColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message =
    typeof candidate.message === "string" ? candidate.message : "";

  return (
    (code === "42703" || code === "PGRST204") &&
    /\bsearch_text\b/iu.test(message)
  );
}
