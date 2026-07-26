import { describe, it, expect } from "vitest";
import { extractSenderName } from "../lib/senderUtils";

describe("extractSenderName()", () => {
  it("應從含尖括號的 sender 提取顯示名稱", () => {
    expect(extractSenderName("Alice <alice@example.com>")).toBe("Alice");
  });

  it("應去除顯示名稱的雙引號", () => {
    expect(extractSenderName('"Alice" <alice@example.com>')).toBe("Alice");
  });

  it("應去除顯示名稱的單引號", () => {
    expect(extractSenderName("'Bob Smith' <bob@example.com>")).toBe("Bob Smith");
  });

  it("純地址（無尖括號）應原樣回傳", () => {
    expect(extractSenderName("bob@example.com")).toBe("bob@example.com");
  });

  it("純名稱（無尖括號）應原樣回傳", () => {
    expect(extractSenderName("Alice")).toBe("Alice");
  });

  it("含空格的顯示名稱應完整保留", () => {
    expect(extractSenderName("Bob Smith <bob@example.com>")).toBe("Bob Smith");
  });

  it("空字串應原樣回傳", () => {
    expect(extractSenderName("")).toBe("");
  });

  it("含多個尖括號時應匹配第一對", () => {
    expect(extractSenderName("Test <a@b.com> <c@d.com>")).toBe("Test");
  });

  it("尖括號前無空格也應正常匹配", () => {
    expect(extractSenderName("Alice<alice@example.com>")).toBe("Alice");
  });
});
