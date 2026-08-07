import { describe, it, expect, vi, afterEach } from "vitest";
import { getDeployTarget, isSelfHosted } from "../lib/deployTarget";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deployTarget", () => {
  it("未設定 DEPLOY_TARGET 時預設為 vercel", () => {
    vi.stubEnv("DEPLOY_TARGET", "");
    expect(getDeployTarget()).toBe("vercel");
    expect(isSelfHosted()).toBe(false);
  });

  it("DEPLOY_TARGET=node 時為自托管", () => {
    vi.stubEnv("DEPLOY_TARGET", "node");
    expect(getDeployTarget()).toBe("node");
    expect(isSelfHosted()).toBe(true);
  });

  it("DEPLOY_TARGET=vercel 時為 vercel", () => {
    vi.stubEnv("DEPLOY_TARGET", "vercel");
    expect(getDeployTarget()).toBe("vercel");
  });

  it("無法辨識的值一律退回 vercel，避免打錯字誤入未驗證的路徑", () => {
    vi.stubEnv("DEPLOY_TARGET", "nodejs");
    expect(getDeployTarget()).toBe("vercel");
    expect(isSelfHosted()).toBe(false);
  });

  it("每次呼叫都重新讀取，切換後立即生效（不可在模組載入時快取）", () => {
    vi.stubEnv("DEPLOY_TARGET", "node");
    expect(isSelfHosted()).toBe(true);
    vi.stubEnv("DEPLOY_TARGET", "vercel");
    expect(isSelfHosted()).toBe(false);
  });
});
