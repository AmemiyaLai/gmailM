import { describe, expect, it } from "vitest";
import { normalizeSenderAddress } from "../lib/senderAddress";

describe("normalizeSenderAddress()", () => {
  it("純地址會轉為小寫", () => {
    expect(normalizeSenderAddress("Alice@Example.COM")).toBe("alice@example.com");
  });

  it("含顯示名稱的 From 標頭會取得尖括號內地址", () => {
    expect(normalizeSenderAddress('"Alice" <Alice@Example.COM>')).toBe("alice@example.com");
  });

  it("無效 From 標頭不會產生識別值", () => {
    expect(normalizeSenderAddress("Alice <not-an-email>")).toBeNull();
    expect(normalizeSenderAddress("alice@example")).toBeNull();
  });
});
