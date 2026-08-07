/**
 * 伺服器端環境變數的統一讀取入口。
 *
 * ## 為什麼不直接用 import.meta.env
 * Vite 會在 build 時把 `import.meta.env.FOO` 這種「靜態成員存取」替換成字面值。
 * 在 Vercel 上這碰巧可行（build 環境就有完整變數），但自托管會踩到兩個問題：
 *
 *   1. 機密（Supabase service key、CRON_SECRET、Discord bot token…）被硬編碼進
 *      dist/ 產物，產物本身變成機密載體，不能在機器之間搬運或快取。
 *   2. 換掉任何一個變數都必須重新 build，改 systemd 的 EnvironmentFile 後重啟無效。
 *
 * 改讀 process.env，值一律在**呼叫時**取得，
 * 因此 vitest 的 vi.stubEnv 與 systemd 的 EnvironmentFile 都有效。
 *
 * ## 為什麼連 import.meta.env 的 fallback 都不能留
 * 對 `import.meta.env` 做動態索引（`meta[name]`）會讓 Vite 放棄靜態分析，
 * 轉而把**整份 env 物件**實體化進 bundle —— 結果比原本的逐一 inline 更糟，
 * 連沒被用到的變數都會一起進去。本機開發所需的 .env 改由 astro.config.mjs
 * 在啟動時灌進 process.env，效果相同且不留痕跡在產物裡。
 *
 * ## PUBLIC_ 變數不適用
 * PUBLIC_PUSHER_KEY 之類會被送進瀏覽器，本來就必須在 build 時 inline，
 * 應繼續直接寫 `import.meta.env.PUBLIC_X`，不要走這個 helper。
 */

/** 讀取伺服器端環境變數；未設定或為空字串時回傳 undefined。 */
export function env(name: string): string | undefined {
  const value = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return value !== undefined && value !== "" ? value : undefined;
}

/** 讀取伺服器端環境變數，未設定時回傳空字串 —— 給既有「取值後自行判斷 falsy」的呼叫端用。 */
export function envOr(name: string, fallback = ""): string {
  return env(name) ?? fallback;
}
