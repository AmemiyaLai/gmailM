import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E 測試設定
 * 文件：https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  // E2E 測試檔案路徑
  testDir: "./e2e",

  // 測試檔案命名規則
  testMatch: "**/*.{spec,test}.{js,ts}",

  // 每個測試的超時時間（毫秒）
  timeout: 30_000,

  // 期望斷言的超時時間
  expect: {
    timeout: 5_000,
  },

  // CI 環境時禁止 .only（防止遺忘的 test.only 造成 CI 誤判）
  forbidOnly: !!process.env.CI,

  // 失敗時重試次數（CI 環境建議 2 次，本地 0 次）
  retries: process.env.CI ? 2 : 0,

  // 並行測試的 Worker 數量
  workers: process.env.CI ? 1 : undefined,

  // 報告格式
  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["list"],
  ],

  // 所有測試共用的基礎設定
  use: {
    // 基礎 URL（對應 Astro 開發伺服器）
    baseURL: "http://localhost:1008",

    // 失敗時自動截圖
    screenshot: "only-on-failure",

    // 失敗時儲存 trace（方便除錯）
    trace: "on-first-retry",

    // 失敗時儲存影片
    video: "on-first-retry",
  },

  // 瀏覽器測試矩陣
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    // 行動裝置測試（視需求取消註解）
    // {
    //   name: "mobile-chrome",
    //   use: { ...devices["Pixel 5"] },
    // },
    // {
    //   name: "mobile-safari",
    //   use: { ...devices["iPhone 12"] },
    // },
  ],

  // 執行測試前自動啟動開發伺服器
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1008",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
