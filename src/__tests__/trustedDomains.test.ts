import { describe, it, expect } from "vitest";
import { matchTrustedDomain, normalizeDomain } from "../lib/trustedDomains";

describe("normalizeDomain", () => {
  it("應轉小寫並移除前後空白與 FQDN 尾點", () => {
    expect(normalizeDomain("  Apple.COM.  ")).toBe("apple.com");
  });

  it("應對 null／空字串回傳 null", () => {
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
  });
});

describe("matchTrustedDomain", () => {
  it("應精確命中白名單網域", () => {
    expect(matchTrustedDomain("apple.com")?.label).toBe("Apple");
  });

  it("應命中子網域", () => {
    expect(matchTrustedDomain("mail.taipei.gov.tw")?.label).toBe("中華民國政府機關");
    expect(matchTrustedDomain("insideapple.apple.com")?.label).toBe("Apple");
  });

  it("不應命中僅為後綴字串的相似網域", () => {
    expect(matchTrustedDomain("notapple.com")).toBeNull();
    expect(matchTrustedDomain("apple.com.evil.tw")).toBeNull();
  });

  it("應忽略大小寫與尾點", () => {
    expect(matchTrustedDomain("GITHUB.COM.")?.label).toBe("GitHub");
  });

  it("應對 null 輸入回傳 null", () => {
    expect(matchTrustedDomain(null)).toBeNull();
  });

  it("多筆命中時應取最具體（網域最長）者", () => {
    // gov.tw 與假想的更長項目重疊時取最長；此處以 edu.tw 驗證不會誤配 gov.tw
    expect(matchTrustedDomain("lib.ntu.edu.tw")?.domain).toBe("edu.tw");
  });
});
