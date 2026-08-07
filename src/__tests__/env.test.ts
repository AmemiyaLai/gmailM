import { describe, it, expect, vi, afterEach } from "vitest";
import { env, envOr } from "../lib/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("env", () => {
  it("讀得到 process.env 的值", () => {
    vi.stubEnv("SOME_SERVER_SECRET", "s3cret");
    expect(env("SOME_SERVER_SECRET")).toBe("s3cret");
  });

  it("未設定時回傳 undefined", () => {
    expect(env("DEFINITELY_NOT_SET_XYZ")).toBeUndefined();
  });

  it("空字串視為未設定 —— 呼叫端普遍以 falsy 判斷是否配置", () => {
    vi.stubEnv("SOME_SERVER_SECRET", "");
    expect(env("SOME_SERVER_SECRET")).toBeUndefined();
  });

  it("在呼叫時取值，變更後立即生效（值不可被 build 或模組載入時凍結）", () => {
    vi.stubEnv("ROTATING_KEY", "old");
    expect(env("ROTATING_KEY")).toBe("old");
    vi.stubEnv("ROTATING_KEY", "new");
    expect(env("ROTATING_KEY")).toBe("new");
  });
});

describe("envOr", () => {
  it("未設定時回傳預設值", () => {
    expect(envOr("DEFINITELY_NOT_SET_XYZ")).toBe("");
    expect(envOr("DEFINITELY_NOT_SET_XYZ", "fallback")).toBe("fallback");
  });

  it("有值時回傳實際值", () => {
    vi.stubEnv("SOME_SERVER_SECRET", "actual");
    expect(envOr("SOME_SERVER_SECRET", "fallback")).toBe("actual");
  });
});
