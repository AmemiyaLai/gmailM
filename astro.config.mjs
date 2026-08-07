// @ts-check
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import vercel from "@astrojs/vercel";

/**
 * 把 .env 灌進 process.env。
 *
 * 伺服器端變數一律經由 src/lib/env.ts 讀 process.env（而非 import.meta.env），
 * 這樣機密才不會被 Vite 在 build 時 inline 進產物。代價是本機開發要自己補這一步 ——
 * Vite 預設只把 .env 載到 import.meta.env，不會寫進 process.env。
 *
 * 用 ??= 不覆蓋既有值：正式環境由部署平台提供的變數優先權高於 repo 內的 .env。
 */
const dotenv = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");
for (const [key, value] of Object.entries(dotenv)) {
  process.env[key] ??= value;
}

export default defineConfig({
  site: "https://gmailm.autodesignlab.org",
  output: "server",
  adapter: vercel(),
  server: {
    host: true,
    port: 1008,
  },
  vite: {
    css: {
      transformer: "lightningcss",
    },
  },
});
