const SEARCH_TERM_SEPARATOR = /\s+/u;
const ILIKE_SPECIAL_CHARACTERS = /[\\%_]/gu;

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
