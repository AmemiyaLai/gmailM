import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

try {
  execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
} catch {
  console.log("略過 Git Hooks 設定：目前目錄不是 Git 倉庫。");
  process.exit(0);
}

if (!existsSync(".githooks")) {
  console.error("找不到 .githooks 目錄，無法設定 Git Hooks。");
  process.exit(1);
}

execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "inherit" });
console.log("Git Hooks 已設定為 .githooks。");
