import { test, expect } from "@playwright/test";

test.describe("首頁", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("應正確顯示頁面標題", async ({ page }) => {
    await expect(page).toHaveTitle(/Gmail Monitor/);
  });

  test("應包含 h1 標題元素", async ({ page }) => {
    const heading = page.locator("main h1");
    await expect(heading).toBeAttached();
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
    const headings = page.locator("main h1");
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

test.describe("側邊欄", () => {
  test("可折疊並記住使用者設定", async ({ page }) => {
    await page.goto("/");

    const sidebar = page.locator(".app-sidebar");
    const toggle = page.getByRole("button", { name: "折疊側邊欄" });
    await expect(sidebar).toHaveCSS("width", "240px");

    await toggle.click();
    await expect(sidebar).toHaveCSS("width", "64px");
    await expect(page.getByRole("button", { name: "展開側邊欄" })).toHaveAttribute("aria-expanded", "false");

    await page.reload();
    await expect(sidebar).toHaveCSS("width", "64px");

    await page.getByRole("button", { name: "展開側邊欄" }).click();
    await expect(sidebar).toHaveCSS("width", "240px");
  });
});

test.describe("頂層導航列", () => {
  test("捲動時保持在最上層且不被內容遮蓋", async ({ page }) => {
    await page.goto("/");

    const header = page.locator(".site-header");
    await expect(header).toHaveCSS("position", "sticky");
    await expect(header).toHaveCSS("z-index", "2000");

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(header).toBeInViewport();

    const headerBox = await header.boundingBox();
    expect(headerBox?.y).toBe(0);
  });
});

test.describe("郵件分析頁", () => {
  test("應提供分析頁與時間範圍控制", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/analytics?range=30d");
    await expect(page).toHaveTitle(/郵件分析/);
    await expect(page.getByRole("heading", { name: "郵件分析" })).toBeVisible();
    await expect(page.locator('select[name="range"]')).toHaveValue("30d");
    await expect(page.getByRole("link", { name: "郵件分析" })).toBeVisible();
    const painted = await page.locator("canvas").evaluateAll((canvases) => canvases.map((node) => {
      const canvas = node as HTMLCanvasElement;
      const context = canvas.getContext("2d");
      return !!context && [...context.getImageData(0, 0, canvas.width, canvas.height).data].some((value, index) => index % 4 === 3 && value > 0);
    }));
    expect(painted).toEqual(expect.arrayContaining([true]));
    expect(errors).toEqual([]);
  });
});
