import { existsSync } from "node:fs";

const requiredRoutes = [
  "src/pages/index.astro",
  "src/pages/knowledge/index.astro",
  "src/pages/knowledge/[...slug].astro",
  "src/pages/search.astro",
  "src/pages/about.astro",
  "src/pages/404.astro",
  "functions/api/health.ts",
];

const missing = requiredRoutes.filter((file) => !existsSync(file));
if (missing.length) {
  console.error(`缺少必要路由或 API：\n${missing.join("\n")}`);
  process.exit(1);
}

console.log(`路由基線檢查通過（${requiredRoutes.length} 項）。`);
