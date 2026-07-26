import { describe, it, expect } from "vitest";
import { classifyEmail, rules, categories } from "../lib/classify";

describe("classifyEmail()", () => {
  describe("devlog 分類", () => {
    it("應將 GitHub 發送者歸類為 devlog", () => {
      expect(
        classifyEmail({ sender: "noreply@github.com", subject: "test" }),
      ).toBe("devlog");
    });

    it("應將 GitLab 發送者歸類為 devlog", () => {
      expect(
        classifyEmail({ sender: "notifications@gitlab.com", subject: "test" }),
      ).toBe("devlog");
    });

    it("應不區分大小寫匹配 sender", () => {
      expect(
        classifyEmail({ sender: "NOREPLY@GITHUB.COM", subject: "test" }),
      ).toBe("devlog");
    });
  });

  describe("newsletter 分類", () => {
    it("應將含「電子報」的主旨歸類為 newsletter", () => {
      expect(
        classifyEmail({ sender: "someone@example.com", subject: "本週電子報" }),
      ).toBe("newsletter");
    });

    it("應將含 newsletter 的主旨歸類為 newsletter", () => {
      expect(
        classifyEmail({
          sender: "someone@example.com",
          subject: "Weekly Newsletter",
        }),
      ).toBe("newsletter");
    });

    it("應將含 digest 的主旨歸類為 newsletter", () => {
      expect(
        classifyEmail({
          sender: "someone@example.com",
          subject: "Daily Digest",
        }),
      ).toBe("newsletter");
    });

    it("應不區分大小寫匹配主旨", () => {
      expect(
        classifyEmail({
          sender: "someone@example.com",
          subject: "NEWSLETTER UPDATE",
        }),
      ).toBe("newsletter");
    });
  });

  describe("system 分類", () => {
    it("應將 no-reply@ 發送者歸類為 system", () => {
      expect(
        classifyEmail({
          sender: "no-reply@example.com",
          subject: "test",
        }),
      ).toBe("system");
    });

    it("應將 noreply@ 發送者歸類為 system", () => {
      expect(
        classifyEmail({
          sender: "noreply@example.com",
          subject: "test",
        }),
      ).toBe("system");
    });

    it("應將 notifications@ 發送者歸類為 system", () => {
      expect(
        classifyEmail({
          sender: "notifications@example.com",
          subject: "test",
        }),
      ).toBe("system");
    });
  });

  describe("banking 分類", () => {
    it("應將銀行寄件者歸類為 banking", () => {
      expect(
        classifyEmail({ sender: "service@esunbank.com.tw", subject: "帳單通知" }),
      ).toBe("banking");
    });

    it("應將 PayPal 寄件者歸類為 banking", () => {
      expect(
        classifyEmail({ sender: "service@paypal.com", subject: "收據" }),
      ).toBe("banking");
    });
  });

  describe("ecommerce 分類", () => {
    it("應將 Shopee 寄件者歸類為 ecommerce", () => {
      expect(
        classifyEmail({ sender: "order@shopee.tw", subject: "訂單成立" }),
      ).toBe("ecommerce");
    });

    it("應將 Amazon 寄件者歸類為 ecommerce", () => {
      expect(
        classifyEmail({ sender: "ship-confirm@amazon.com", subject: "Your order" }),
      ).toBe("ecommerce");
    });
  });

  describe("securities 分類", () => {
    it("應將證券商寄件者歸類為 securities", () => {
      expect(
        classifyEmail({ sender: "service@kgisecurities.com.tw", subject: "對帳單" }),
      ).toBe("securities");
    });

    it("應將含 stock 的寄件者歸類為 securities", () => {
      expect(
        classifyEmail({ sender: "alerts@stocknotify.com", subject: "test" }),
      ).toBe("securities");
    });
  });

  describe("uncategorized 分類", () => {
    it("應將不匹配任何規則的郵件歸類為 uncategorized", () => {
      expect(
        classifyEmail({
          sender: "friend@gmail.com",
          subject: "Hey, how are you?",
        }),
      ).toBe("uncategorized");
    });
  });

  describe("規則優先序", () => {
    it("senderIncludes 應優先於 subjectMatches", () => {
      expect(
        classifyEmail({
          sender: "no-reply@github.com",
          subject: "本週電子報",
        }),
      ).toBe("devlog");
    });
  });

  describe("空值處理", () => {
    it("應處理空 subject", () => {
      expect(
        classifyEmail({ sender: "someone@example.com", subject: "" }),
      ).toBe("uncategorized");
    });

    it("應處理 null subject", () => {
      expect(
        classifyEmail({
          sender: "someone@example.com",
          subject: null as unknown as string,
        }),
      ).toBe("uncategorized");
    });
  });
});

describe("rules", () => {
  it("應包含 devlog 規則", () => {
    expect(rules.find((r) => r.category === "devlog")).toBeDefined();
  });

  it("應包含 newsletter 規則", () => {
    expect(rules.find((r) => r.category === "newsletter")).toBeDefined();
  });

  it("應包含 system 規則", () => {
    expect(rules.find((r) => r.category === "system")).toBeDefined();
  });
});

describe("categories", () => {
  it("應包含所有規則類別加上 uncategorized", () => {
    expect(categories).toContain("devlog");
    expect(categories).toContain("newsletter");
    expect(categories).toContain("system");
    expect(categories).toContain("banking");
    expect(categories).toContain("ecommerce");
    expect(categories).toContain("securities");
    expect(categories).toContain("uncategorized");
  });

  it("應有 7 個類別", () => {
    expect(categories.length).toBe(7);
  });
});
