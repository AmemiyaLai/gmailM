import { test, expect } from "@playwright/test";

test.describe("首頁", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("應正確顯示頁面標題", async ({ page }) => {
    await expect(page).toHaveTitle(/Gmail Monitor/);
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
