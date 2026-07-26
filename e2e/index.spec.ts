import { test, expect } from "@playwright/test";

/**
 * E2E 測試：首頁
 *
 * 測試範例，說明如何撰寫 Playwright E2E 測試。
 * 執行：npm run test:e2e
 */

test.describe("首頁", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("應正確顯示頁面標題", async ({ page }) => {
    await expect(page).toHaveTitle(/Knowledge Starter/);
  });

  test("應包含 h1 標題元素", async ({ page }) => {
    const heading = page.locator("h1");
    await expect(heading).toBeVisible();
  });

  test("應正確設定 meta description", async ({ page }) => {
    const metaDescription = page.locator('meta[name="description"]');
    await expect(metaDescription).toHaveAttribute("content", /.+/);
  });

  test("應有正確的 lang 屬性", async ({ page }) => {
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "zh-TW");
  });

  test("應可進入內容驅動的知識庫路由", async ({ page }) => {
    await page.goto("/knowledge/introduction");
    await expect(page.locator("h1")).toContainText("範例介紹");
  });

  test("外部連結應在新分頁開啟", async ({ page }) => {
    const externalLinks = page.locator('a[href^="http"]');
    const count = await externalLinks.count();

    for (let i = 0; i < count; i++) {
      const link = externalLinks.nth(i);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
    }
  });
});

test.describe("無障礙基礎檢查", () => {
  test("每頁只能有一個 h1", async ({ page }) => {
    await page.goto("/");
    const headings = page.locator("h1");
    await expect(headings).toHaveCount(1);
  });

  test("所有圖片應有 alt 屬性", async ({ page }) => {
    await page.goto("/");
    const images = page.locator("img");
    const count = await images.count();

    for (let i = 0; i < count; i++) {
      const img = images.nth(i);
      await expect(img).toHaveAttribute("alt", /.*/);
    }
  });
});
