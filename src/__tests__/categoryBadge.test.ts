import { describe, it, expect } from "vitest";
import { categoryBadge } from "../lib/categoryBadge";

describe("categoryBadge()", () => {
  it("應回傳 devlog 的 badge 資訊", () => {
    const badge = categoryBadge("devlog");
    expect(badge).not.toBeNull();
    expect(badge!.label).toBe("開發日誌");
    expect(badge!.bg).toBe("var(--color-info)");
    expect(badge!.color).toBe("white");
  });

  it("應回傳 newsletter 的 badge 資訊", () => {
    const badge = categoryBadge("newsletter");
    expect(badge).not.toBeNull();
    expect(badge!.label).toBe("電子報");
  });

  it("應回傳 system 的 badge 資訊", () => {
    const badge = categoryBadge("system");
    expect(badge).not.toBeNull();
    expect(badge!.label).toBe("系統通知");
  });

  it("應對未知類別回傳 null", () => {
    expect(categoryBadge("unknown")).toBeNull();
  });

  it("應對 null 回傳 null", () => {
    expect(categoryBadge(null)).toBeNull();
  });

  it("應對 undefined 回傳 null", () => {
    expect(categoryBadge(undefined)).toBeNull();
  });

  it("應對空字串回傳 null", () => {
    expect(categoryBadge("")).toBeNull();
  });
});
