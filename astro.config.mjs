// @ts-check
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import vercel from "@astrojs/vercel";
import node from "@astrojs/node";

/**
 * 把 .env 灌進 process.env。
 *
 * 伺服器端變數一律經由 src/lib/env.ts 讀 process.env（而非 import.meta.env），
 * 這樣機密才不會被 Vite 在 build 時 inline 進 dist/。代價是本機開發要自己補這一步 ——
 * Vite 預設只把 .env 載到 import.meta.env，不會寫進 process.env。
 *
 * 用 ??= 不覆蓋既有值：正式環境由 systemd 的 EnvironmentFile 提供，優先權高於 repo 內的 .env。
 */
const dotenv = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");
for (const [key, value] of Object.entries(dotenv)) {
  process.env[key] ??= value;
}

/**
 * 部署目標切換開關。
 *
 *   DEPLOY_TARGET=node    → 自托管（Oracle Cloud + Cloudflare Tunnel）
 *   未設定 / 其他值        → Vercel（預設，維持原行為）
 *
 * 兩個 adapter 都保留在 dependencies，切換只需改環境變數後重新 build，
 * 隨時可以切回去。runtime 端的對應判定在 src/lib/deployTarget.ts。
 */
const selfHosted = process.env.DEPLOY_TARGET === "node";

export default defineConfig({
  site: "https://gmailm.autodesignlab.org",
  output: "server",
  // standalone 會產出自帶 HTTP server 的 dist/server/entry.mjs，並自行 serve 靜態檔，
  // 監聽位址由 runtime 的 HOST / PORT 環境變數決定（見 scripts/deploy/gmailm.service）。
  adapter: selfHosted ? node({ mode: "standalone" }) : vercel(),
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
