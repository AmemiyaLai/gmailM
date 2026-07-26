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

export function getSupabase() {
  if (!client) {
    const url = import.meta.env.SUPABASE_URL;
    const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!isValidUrl(url) || !key || key.includes("your_service_role_key")) {
      console.warn("Supabase 未配置或使用預設佔位符，開發預覽啟用虛擬數據防禦。");
      // 回傳 Mock Supabase Client 物件避免 SSR 致命崩潰
      return {
        from: () => ({
          select: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
            eq: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
            textSearch: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      } as unknown as ReturnType<typeof createClient>;
    }
    client = createClient(url, key);
  }
  return client;
}
