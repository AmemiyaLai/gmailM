import { readFileSync } from "node:fs";

const messageFile = process.argv[2];
if (!messageFile) {
  console.error("缺少 commit 訊息檔案。");
  process.exit(1);
}

const message = readFileSync(messageFile, "utf8").trim();
const subject = message.split(/\r?\n/, 1)[0] ?? "";

if (!subject || /^(Merge |Revert )/.test(subject)) process.exit(0);

const conventional = /^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert)(\([^)]+\))?!?: .{1,72}$/;
if (!conventional.test(subject)) {
  console.error("\n[Git Hook] Commit 訊息必須符合 Conventional Commits：");
  console.error("  <type>(<scope>): <description>");
  console.error("  例如：feat(gmail): 新增寄件者篩選");
  console.error("  允許 type：feat、fix、docs、style、refactor、perf、test、chore、ci、build、revert");
  process.exit(1);
}
