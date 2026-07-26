import { describe, it, expect } from "vitest";
import { getSenderGroupId, findSenderGroup, SENDER_GROUPS } from "../lib/senderGroups";

describe("SENDER_GROUPS", () => {
  it("應包含 6 個群組", () => {
    expect(SENDER_GROUPS).toHaveLength(6);
  });

  it("最後一個群組應為 others（兜底）", () => {
    expect(SENDER_GROUPS[5].id).toBe("others");
    expect(SENDER_GROUPS[5].patterns).toEqual([]);
  });

  it("每個群組都應有 id, label, icon, colorVar, patterns", () => {
    for (const group of SENDER_GROUPS) {
      expect(group.id).toBeTruthy();
      expect(group.label).toBeTruthy();
      expect(group.icon).toBeTruthy();
      expect(group.colorVar).toBeTruthy();
      expect(Array.isArray(group.patterns)).toBe(true);
    }
  });
});

describe("getSenderGroupId()", () => {
  describe("銀行/金融", () => {
    it("應將玉山銀行 sender 匹配為 banking", () => {
      expect(getSenderGroupId("esunbank@esun.com")).toBe("banking");
    });

    it("應將中國信託 sender 匹配為 banking", () => {
      expect(getSenderGroupId("ctbc@ctbc.com")).toBe("banking");
    });

    it("應將 PayPal sender 匹配為 banking", () => {
      expect(getSenderGroupId("service@paypal.com")).toBe("banking");
    });

    it("應將 Stripe sender 匹配為 banking", () => {
      expect(getSenderGroupId("receipts@stripe.com")).toBe("banking");
    });

    it("應將含 bank 的 sender 匹配為 banking", () => {
      expect(getSenderGroupId("notifications@mybank.com")).toBe("banking");
    });
  });

  describe("程式碼/開發", () => {
    it("應將 GitHub sender 匹配為 devtools", () => {
      expect(getSenderGroupId("noreply@github.com")).toBe("devtools");
    });

    it("應將 GitLab sender 匹配為 devtools", () => {
      expect(getSenderGroupId("notifications@gitlab.com")).toBe("devtools");
    });

    it("應將 Vercel sender 匹配為 devtools", () => {
      expect(getSenderGroupId("notifications@vercel.com")).toBe("devtools");
    });

    it("應將 Supabase sender 匹配為 devtools", () => {
      expect(getSenderGroupId("noreply@supabase.com")).toBe("devtools");
    });

    it("應將 AWS sender 匹配為 devtools", () => {
      expect(getSenderGroupId("no-reply@aws.amazon.com")).toBe("devtools");
    });

    it("應將 Jira sender 匹配為 devtools", () => {
      expect(getSenderGroupId("jira@atlassian.com")).toBe("devtools");
    });
  });

  describe("電子商務", () => {
    it("應將 Shopee sender 匹配為 ecommerce", () => {
      expect(getSenderGroupId("service@shopee.com")).toBe("ecommerce");
    });

    it("應將 momo sender 匹配為 ecommerce", () => {
      expect(getSenderGroupId("order@momo.com")).toBe("ecommerce");
    });

    it("應將 Amazon sender 匹配為 ecommerce", () => {
      expect(getSenderGroupId("shipment-tracking@amazon.com")).toBe("ecommerce");
    });

    it("應將 eBay sender 匹配為 ecommerce", () => {
      expect(getSenderGroupId("ebay@ebay.com")).toBe("ecommerce");
    });
  });

  describe("電子報", () => {
    it("應將 Substack sender 匹配為 newsletter", () => {
      expect(getSenderGroupId("newsletter@substack.com")).toBe("newsletter");
    });

    it("應將 Medium sender 匹配為 newsletter", () => {
      expect(getSenderGroupId("digest@medium.com")).toBe("newsletter");
    });

    it("應將 Mailchimp sender 匹配為 newsletter", () => {
      expect(getSenderGroupId("campaign@mailchimp.com")).toBe("newsletter");
    });
  });

  describe("證券/投資", () => {
    it("應將凱基證券 sender 匹配為 securities", () => {
      expect(getSenderGroupId("凱基證券通知")).toBe("securities");
    });

    it("應將元大 sender 匹配為 securities", () => {
      expect(getSenderGroupId("元大投信")).toBe("securities");
    });

    it("應將含 securities 的 sender 匹配為 securities", () => {
      expect(getSenderGroupId("notifications@sec-securities.com")).toBe("securities");
    });
  });

  describe("其他（兜底）", () => {
    it("不匹配任何群組時應回傳 others", () => {
      expect(getSenderGroupId("random-person@gmail.com")).toBe("others");
    });

    it("空字串應回傳 others", () => {
      expect(getSenderGroupId("")).toBe("others");
    });
  });

  describe("大小寫不敏感", () => {
    it("應不區分大小寫匹配", () => {
      expect(getSenderGroupId("GITHUB@GITHUB.COM")).toBe("devtools");
      expect(getSenderGroupId("PAYPAL@PAYPAL.COM")).toBe("banking");
      expect(getSenderGroupId("SHOPEE@SHOPEE.COM")).toBe("ecommerce");
    });
  });

  describe("匹配優先順序", () => {
    it("應按照 SENDER_GROUPS 陣列順序優先匹配", () => {
      // "yuanta" 在 banking 群組，"yuanta sec" 在 securities 群組
      // banking 先出現，所以 "yuanta" 應匹配 banking
      expect(getSenderGroupId("yuanta@yuanta.com")).toBe("banking");
    });
  });
});

describe("findSenderGroup()", () => {
  it("應回傳存在的群組定義", () => {
    const group = findSenderGroup("banking");
    expect(group).not.toBeNull();
    expect(group!.id).toBe("banking");
    expect(group!.label).toBe("銀行 / 金融");
  });

  it("應回傳 others 群組", () => {
    const group = findSenderGroup("others");
    expect(group).not.toBeNull();
    expect(group!.id).toBe("others");
  });

  it("不存在的 id 應回傳 null", () => {
    expect(findSenderGroup("nonexistent")).toBeNull();
  });

  it("空字串應回傳 null", () => {
    expect(findSenderGroup("")).toBeNull();
  });
});
