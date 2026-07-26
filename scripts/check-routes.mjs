import { existsSync } from "node:fs";

const requiredRoutes = [
  "src/pages/index.astro",
  "src/pages/404.astro",
  "src/pages/search.astro",
  "src/pages/api/webhook/gmail.ts",
  "src/pages/api/gmail/watch-renew.ts",
  "src/pages/api/emails/[id]/read.ts",
  "src/pages/emails/[id].astro",
  "src/pages/emails/index.astro",
  "src/pages/unread.astro",
];

const missing = requiredRoutes.filter((file) => !existsSync(file));
if (missing.length) {
  console.error(`缺少必要路由或 API：\n${missing.join("\n")}`);
  process.exit(1);
}

console.log(`路由基線檢查通過（${requiredRoutes.length} 項）。`);
