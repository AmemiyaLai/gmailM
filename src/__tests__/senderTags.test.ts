import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/senderAddress", () => ({
  normalizeSenderAddress: vi.fn((s: string) => {
    const m = s.match(/<\s*([^<>()\s]+@[^<>()\s]+)\s*>/);
    if (m) return m[1].toLowerCase();
    if (/^[^<>()\s]+@[^<>()\s]+$/.test(s.trim())) return s.trim().toLowerCase();
    return null;
  }),
}));

import {
  senderKey,
  classifySenderTagByRule,
  isSenderTag,
  aggregateRareAutoTags,
  SENDER_TAGS,
  OTHER_SENDER_TAG,
  SENDER_TAG_CONFIDENCE_THRESHOLD,
  senderTagLabels,
  type SenderTag,
} from "../lib/senderTags";

describe("寄件者共享標籤", () => {
  it("會以地址合併顯示名稱與大小寫不同的同一寄件者", () => {
    expect(senderKey('"Alice" <Alice@Example.COM>')).toBe("alice@example.com");
    expect(senderKey("alice@example.com")).toBe("alice@example.com");
  });

  it("規則可判定高信心的寄件者主題", () => {
    expect(classifySenderTagByRule({ sender: "GitHub <noreply@github.com>" })).toEqual({ tag: "development", confidence: 0.95 });
    expect(classifySenderTagByRule({ sender: "未知 <hello@example.com>" })).toBeNull();
  });

  it("只有一位自動寄件者使用的標籤會聚合為其他通知", () => {
    const rows = aggregateRareAutoTags([
      { tag: "travel" as const, source: "auto" as const, was_aggregated: false },
      { tag: "development" as const, source: "auto" as const, was_aggregated: false },
      { tag: "development" as const, source: "auto" as const, was_aggregated: false },
    ]);
    expect(rows[0]).toEqual({ tag: "other", source: "auto", was_aggregated: true });
    expect(rows[1].tag).toBe("development");
  });

  it("手動標籤不會因聚合規則被覆寫", () => {
    const [row] = aggregateRareAutoTags([{ tag: "travel" as const, source: "manual" as const, was_aggregated: false }]);
    expect(row.tag).toBe("travel");
  });
});

describe("senderKey()", () => {
  it("含尖括號的 From 標頭應回傳小寫正規化地址", () => {
    expect(senderKey("Alice <Alice@Example.COM>")).toBe("alice@example.com");
  });

  it("純地址應轉為小寫", () => {
    expect(senderKey("BOB@example.com")).toBe("bob@example.com");
  });

  it("無法解析的地址應保留原始值小寫並去除多餘空格", () => {
    expect(senderKey("Some User")).toBe("some user");
  });

  it("空字串應回傳空字串", () => {
    expect(senderKey("")).toBe("");
  });

  it("含多餘空格的輸入應合併為單一空格", () => {
    expect(senderKey("  Hello   World  ")).toBe("hello world");
  });
});

describe("classifySenderTagByRule()", () => {
  it("應匹配銀行關鍵字回傳 banking", () => {
    const result = classifySenderTagByRule({ sender: "notifications@esunbank.com" });
    expect(result).not.toBeNull();
    expect(result!.tag).toBe("banking");
    expect(result!.confidence).toBe(0.95);
  });

  it("應匹配證券關鍵字回傳 securities", () => {
    const result = classifySenderTagByRule({ sender: "凱基證券通知" });
    expect(result).not.toBeNull();
    expect(result!.tag).toBe("securities");
  });

  it("應匹配購物關鍵字回傳 commerce", () => {
    const result = classifySenderTagByRule({ sender: "service@shopee.com", subject: "蝦皮購物訂單" });
    expect(result).not.toBeNull();
    expect(result!.tag).toBe("commerce");
  });

  it("應匹配開發關鍵字回傳 development", () => {
    const result = classifySenderTagByRule({ sender: "noreply@github.com" });
    expect(result).not.toBeNull();
    expect(result!.tag).toBe("development");
  });

  it("應匹配媒體關鍵字回傳 media", () => {
    const result = classifySenderTagByRule({ sender: "newsletter@substack.com" });
    expect(result).not.toBeNull();
    expect(result!.tag).toBe("media");
  });

  it("應匹配學習關鍵字回傳 learning", () => {
    const result = classifySenderTagByRule({ sender: "info@ntu.edu.tw", subject: "課程通知" });
    expect(result).not.toBeNull();
    expect(result!.tag).toBe("learning");
  });

  it("應匹配旅行關鍵字回傳 travel", () => {
    const result = classifySenderTagByRule({ sender: "noreply@trip.com" });
    expect(result).not.toBeNull();
    expect(result!.tag).toBe("travel");
  });

  it("應匹配安全關鍵字回傳 security", () => {
    const result = classifySenderTagByRule({ sender: "idprotect@example.com", subject: "登入安全通知" });
    expect(result).not.toBeNull();
    expect(result!.tag).toBe("security");
  });

  it("不匹配任何規則時應回傳 null", () => {
    const result = classifySenderTagByRule({ sender: "random@example.com", subject: "Hello" });
    expect(result).toBeNull();
  });

  it("應利用 snippet 進行匹配", () => {
    const result = classifySenderTagByRule({
      sender: "unknown@example.com",
      subject: "Notification",
      snippet: "Your GitHub repository was updated",
    });
    expect(result).not.toBeNull();
    expect(result!.tag).toBe("development");
  });

  it("規則匹配應不區分大小寫", () => {
    const result = classifySenderTagByRule({ sender: "GITHUB@GITHUB.COM" });
    expect(result).not.toBeNull();
    expect(result!.tag).toBe("development");
  });
});

describe("isSenderTag()", () => {
  it("有效標籤值應回傳 true", () => {
    for (const tag of SENDER_TAGS) {
      expect(isSenderTag(tag)).toBe(true);
    }
  });

  it("無效字串應回傳 false", () => {
    expect(isSenderTag("invalid")).toBe(false);
    expect(isSenderTag("")).toBe(false);
    expect(isSenderTag("Banking")).toBe(false);
  });

  it("非字串型別應回傳 false", () => {
    expect(isSenderTag(null)).toBe(false);
    expect(isSenderTag(undefined)).toBe(false);
    expect(isSenderTag(123)).toBe(false);
    expect(isSenderTag({})).toBe(false);
  });
});

describe("SENDER_TAGS", () => {
  it("應包含 9 個標籤值", () => {
    expect(SENDER_TAGS).toHaveLength(9);
  });

  it("應包含所有核心標籤", () => {
    expect(SENDER_TAGS).toContain("banking");
    expect(SENDER_TAGS).toContain("securities");
    expect(SENDER_TAGS).toContain("commerce");
    expect(SENDER_TAGS).toContain("development");
    expect(SENDER_TAGS).toContain("media");
    expect(SENDER_TAGS).toContain("learning");
    expect(SENDER_TAGS).toContain("travel");
    expect(SENDER_TAGS).toContain("security");
    expect(SENDER_TAGS).toContain("other");
  });
});

describe("OTHER_SENDER_TAG", () => {
  it("應為 'other'", () => {
    expect(OTHER_SENDER_TAG).toBe("other");
  });
});

describe("SENDER_TAG_CONFIDENCE_THRESHOLD", () => {
  it("應為 0.75", () => {
    expect(SENDER_TAG_CONFIDENCE_THRESHOLD).toBe(0.75);
  });
});

describe("senderTagLabels", () => {
  it("每個標籤都應有對應的中文顯示名", () => {
    for (const tag of SENDER_TAGS) {
      expect(senderTagLabels[tag]).toBeTruthy();
      expect(typeof senderTagLabels[tag]).toBe("string");
    }
  });
});

describe("aggregateRareAutoTags()", () => {
  const baseRow = { source: "auto" as const, was_aggregated: false };

  it("出現次數 >= 2 的 auto tag 應保留", () => {
    const rows = [
      { ...baseRow, tag: "banking" as SenderTag },
      { ...baseRow, tag: "banking" as SenderTag },
    ];
    const result = aggregateRareAutoTags(rows);
    expect(result[0].tag).toBe("banking");
    expect(result[0].was_aggregated).toBe(false);
  });

  it("出現次數 < 2 的 auto tag 應聚合為 other", () => {
    const rows = [
      { ...baseRow, tag: "travel" as SenderTag },
    ];
    const result = aggregateRareAutoTags(rows);
    expect(result[0].tag).toBe("other");
    expect(result[0].was_aggregated).toBe(true);
  });

  it("already other 的 tag 不應被二次聚合處理", () => {
    const rows = [
      { ...baseRow, tag: "other" as SenderTag },
    ];
    const result = aggregateRareAutoTags(rows);
    expect(result[0].tag).toBe("other");
    expect(result[0].was_aggregated).toBe(false);
  });

  it("混合多個 tag 時應正確計算頻率", () => {
    const rows = [
      { ...baseRow, tag: "banking" as SenderTag },
      { ...baseRow, tag: "banking" as SenderTag },
      { ...baseRow, tag: "banking" as SenderTag },
      { ...baseRow, tag: "travel" as SenderTag },
      { ...baseRow, tag: "media" as SenderTag },
    ];
    const result = aggregateRareAutoTags(rows);
    expect(result[0].tag).toBe("banking");
    expect(result[1].tag).toBe("banking");
    expect(result[2].tag).toBe("banking");
    expect(result[3].tag).toBe("other");
    expect(result[3].was_aggregated).toBe(true);
    expect(result[4].tag).toBe("other");
    expect(result[4].was_aggregated).toBe(true);
  });

  it("空陣列應回傳空陣列", () => {
    expect(aggregateRareAutoTags([])).toEqual([]);
  });
});
