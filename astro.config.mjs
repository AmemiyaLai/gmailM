// @ts-check
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  // 部署時請將此替換為你的 Cloudflare Pages 正式網域
  // 用途：BaseHead 中的 canonicalURL 計算與 og:image 路徑
  site: "https://your-domain.com",

  // 建置輸出設定（預設靜態，可切換為 "server" 開啟 SSR）
  output: "static",

  // Vite 開發伺服器設定
  vite: {
    css: {
      // 保留 CSS 自定義屬性（不轉換為靜態值）
      transformer: "lightningcss",
    },
  },
});
