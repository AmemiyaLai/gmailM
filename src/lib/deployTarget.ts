import { env } from "./env";

/**
 * 部署目標的 runtime 判定，與 astro.config.mjs 的 adapter 選擇共用同一個環境變數。
 *
 *   DEPLOY_TARGET=node → 自托管（長駐 Node process）
 *   未設定 / 其他值      → Vercel（預設，維持原行為）
 *
 * 預設偏向 Vercel 是刻意的：漏設變數時退回現狀而不是退到未驗證的路徑，
 * 回滾也只是把變數拿掉。
 */
export type DeployTarget = "vercel" | "node";

export function getDeployTarget(): DeployTarget {
  return env("DEPLOY_TARGET") === "node" ? "node" : "vercel";
}

/** 是否跑在自托管的長駐 Node process 上（而非 serverless 執行實例）。 */
export function isSelfHosted(): boolean {
  return getDeployTarget() === "node";
}
