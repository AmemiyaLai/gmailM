import { createClient } from "@supabase/supabase-js";

let client: ReturnType<typeof createClient> | null = null;

function isValidUrl(url: string | undefined): boolean {
  if (!url || url.includes("your-project.supabase.co")) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function createMockQueryBuilder(): unknown {
  const listResult = { data: [], error: null, count: 0 };
  const singleResult = { data: null, error: null };

  const proxy: unknown = new Proxy(
    () => {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: unknown) => void) => resolve(listResult);
        }
        if (prop === "single" || prop === "maybeSingle") {
          return () => Promise.resolve(singleResult);
        }
        return () => proxy;
      },
    },
  );

  return proxy;
}

/** Supabase 查詢錯誤，帶上發生位置方便定位 */
export class SupabaseQueryError extends Error {
  constructor(context: string, message: string) {
    super(`${context} 查詢失敗：${message}`);
    this.name = "SupabaseQueryError";
  }
}

/**
 * 讀取查詢的結果解包：失敗時明確拋出，而不是回傳 null 讓呼叫端誤判成「查無資料」。
 *
 * 專案多數讀取（emailQueries）沿用「只取 data」的靜默降級寫法，但清理審核這條線不能這樣：
 * 資料表不存在或權限錯誤會被偽裝成「沒有關鍵字／沒有命中的郵件」，送審靜靜跳過不發訊息，
 * 症狀與正常的空結果完全一樣，極難排查。更嚴重的是 claimPending 會把錯誤當成
 * 「已處理過」、idsUnderReview 會把錯誤當成「沒有郵件在審核中」而重複送審。
 */
export function unwrapQuery<T>(
  result: { data: T | null; error: { message: string } | null },
  context: string,
): T | null {
  if (result.error) throw new SupabaseQueryError(context, result.error.message);
  return result.data;
}

export function getSupabase() {
  if (!client) {
    const url = import.meta.env.SUPABASE_URL;
    const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!isValidUrl(url) || !key || key.includes("your_service_role_key")) {
      console.warn("Supabase 未配置或使用預設佔位符，開發預覽啟用虛擬數據防禦。");
      // 回傳 Mock Supabase Client 物件避免 SSR 致命崩潰
      return {
        from: () => createMockQueryBuilder(),
      } as unknown as ReturnType<typeof createClient>;
    }
    client = createClient(url, key);
  }
  return client;
}
