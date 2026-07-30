import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 測試環境：使用 happy-dom 模擬 DOM（輕量，適合 Astro 元件測試）
    environment: "node",

    // 全域測試 API（不需要在每個測試檔 import describe/it/expect）
    globals: true,

    // 測試檔案搜尋路徑
    include: ["src/**/*.{test,spec}.{js,mjs,cjs,jsx,ts,tsx}"],

    // 排除目錄
    exclude: [
      "node_modules",
      "dist",
      ".astro",
      "e2e/**",
      "playwright-report/**",
    ],

    // 覆蓋率報告設定
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      // 覆蓋率閾值
      thresholds: {
        statements: 95,
        branches: 80,
        functions: 90,
        lines: 95,
      },
      // 排除不需要計算覆蓋率的檔案
      exclude: [
        "node_modules/**",
        "dist/**",
        ".astro/**",
        "**/*.config.*",
        "**/*.d.ts",
        "e2e/**",
        "src/env.d.ts",
      ],
    },

    // 測試報告格式
    reporters: ["verbose"],
  },
});
