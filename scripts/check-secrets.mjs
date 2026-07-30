import { execFileSync } from "node:child_process";
import path from "node:path";

const stagedFiles = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"],
  { encoding: "buffer" },
)
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

const sensitiveFile = (file) => {
  const normalized = file.replaceAll("\\", "/");
  const name = path.posix.basename(normalized).toLowerCase();

  if (name === ".env.example") return false;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (/\.(pem|key|p12|pfx|jks|keystore)$/.test(name)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(name)) return true;
  if (/^(client_secret.*|service-account.*|serviceaccountkey|gcp-key|aws-credentials|.*-credentials)\.json$/.test(name)) return true;
  if (name.endsWith(".apps.googleusercontent.com.json")) return true;
  if (["credentials", "secrets.json", ".htpasswd", "shadow"].includes(name)) return true;
  return normalized === ".aws/credentials" || normalized.includes("/.ssh/");
};

const patterns = [
  [/(?:^|[^A-Z0-9])AKIA[0-9A-Z]{16}(?:$|[^A-Z0-9])/i, "疑似 AWS Access Key ID"],
  [/(?:api[_-]?key|apikey)\s*[:=]\s*["'][A-Za-z0-9_-]{20,}["']/i, "疑似 API 金鑰賦值"],
  [/(?:secret|password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/i, "疑似密碼或 Secret 賦值"],
  [/Bearer\s+[A-Za-z0-9\-._~+/]{20,}/i, "疑似 Bearer Token"],
  [/\bghp_[A-Za-z0-9]{36}\b/, "疑似 GitHub Personal Access Token"],
  [/\bgithub_pat_[A-Za-z0-9_]{82}\b/, "疑似 GitHub Fine-grained Token"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "疑似 Google API Key"],
  [/\b(?:sk|pk)_(?:live|test)_[0-9A-Za-z]{24,}\b/, "疑似 Stripe API Key"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/, "疑似硬編碼 JWT"],
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, "疑似私鑰內容"],
  [/(?:mongodb|postgresql|mysql|redis):\/\/[^:\s]+:[^@\s]+@/i, "疑似含密碼的資料庫連線字串"],
];

const placeholder = /(?:example|sample|dummy|placeholder|your_|<[^>]+>|TODO|FIXME)/i;
const errors = [];

for (const file of stagedFiles) {
  if (sensitiveFile(file)) {
    errors.push(`${file}：敏感檔案名稱`);
    continue;
  }

  let content;
  try {
    content = execFileSync("git", ["show", `:${file}`], { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 });
  } catch {
    continue;
  }
  if (content.includes(0)) continue;

  for (const [lineNumber, line] of content.toString("utf8").split(/\r?\n/).entries()) {
    if (placeholder.test(line)) continue;
    for (const [pattern, description] of patterns) {
      if (pattern.test(line)) errors.push(`${file}:${lineNumber + 1}：${description}`);
    }
  }
}

if (errors.length) {
  console.error("\n[Git Hook] 偵測到可能的敏感資訊，已阻止提交：");
  for (const error of errors) console.error(`  - ${error}`);
  console.error("\n請移至環境變數或移除檔案；誤報時可謹慎使用 git commit --no-verify。");
  process.exit(1);
}
