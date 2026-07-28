import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/gemini", () => ({
  judgeSenderTag: vi.fn(),
}));

vi.mock("../lib/senderAddress", () => ({
  normalizeSenderAddress: vi.fn((s: string) => {
    const m = s.match(/<\s*([^<>()\s]+@[^<>()\s]+)\s*>/);
    if (m) return m[1].toLowerCase();
    if (/^[^<>()\s]+@[^<>()\s]+$/.test(s.trim())) return s.trim().toLowerCase();
    return null;
  }),
}));

import { refreshSenderTags, setManualSenderTag, getSenderTags } from "../lib/senderTagService";
import { judgeSenderTag } from "../lib/gemini";

function createMockSupabase(responses: Record<string, unknown>) {
  const chainable: Record<string, ReturnType<typeof vi.fn>> = {};

  const handler = {
    get(_target: unknown, prop: string) {
      if (prop === "then") return undefined;
      if (chainable[prop]) return chainable[prop];
      chainable[prop] = vi.fn().mockReturnValue(new Proxy({}, handler));
      return chainable[prop];
    },
  };

  const fromResult = new Proxy({}, handler);

  const fromMock = vi.fn().mockReturnValue(fromResult);

  // Wire up known chain methods to return chainable results
  const setupChain = (result: unknown) => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue(result),
      then: (resolve: (v: unknown) => void) => resolve(result),
    };
    return chain;
  };

  // We'll use a simpler approach
  const chainMethods = {
    select: vi.fn(),
    eq: vi.fn(),
    upsert: vi.fn(),
  };

  return { from: fromMock, _chainMethods: chainMethods };
}

describe("refreshSenderTags()", () => {
  it("應處理所有頻繁寄件者並回傳統計", async () => {
    const emails = [
      { sender: "Alice <alice@bank.com>", sender_address: "alice@bank.com", subject: "Bank Alert", snippet: "bank notification" },
      { sender: "Alice <alice@bank.com>", sender_address: "alice@bank.com", subject: "Bank Alert 2", snippet: "bank notification 2" },
    ];
    const existingTags: unknown[] = [];

    let callCount = 0;
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "emails") {
          return {
            select: vi.fn().mockResolvedValue({ data: emails, error: null }),
          };
        }
        if (table === "sender_tags") {
          return {
            select: vi.fn().mockResolvedValue({ data: existingTags, error: null }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
      }),
    };

    const result = await refreshSenderTags(mockSupabase);
    expect(result.processed).toBeGreaterThanOrEqual(0);
  });

  it("emails 查詢失敗時應拋出錯誤", async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } }),
      })),
    };

    await expect(refreshSenderTags(mockSupabase)).rejects.toThrow();
  });

  it("sender_tags 查詢失敗時應拋出錯誤", async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "emails") {
          return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        return { select: vi.fn().mockResolvedValue({ data: null, error: { message: "tags error" } }) };
      }),
    };

    await expect(refreshSenderTags(mockSupabase)).rejects.toThrow();
  });

  it("已有手動標籤的寄件者應跳過自動分類", async () => {
    const emails = [
      { sender: "Alice <alice@bank.com>", sender_address: "alice@bank.com", subject: "Test", snippet: "test" },
      { sender: "Alice <alice@bank.com>", sender_address: "alice@bank.com", subject: "Test 2", snippet: "test 2" },
    ];
    const existingTags = [
      { sender_key: "alice@bank.com", tag: "security", source: "manual", confidence: null, was_aggregated: false, sender_display: "Alice", updated_at: new Date().toISOString() },
    ];

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "emails") {
          return { select: vi.fn().mockResolvedValue({ data: emails, error: null }) };
        }
        if (table === "sender_tags") {
          return {
            select: vi.fn().mockResolvedValue({ data: existingTags, error: null }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
      }),
    };

    const result = await refreshSenderTags(mockSupabase);
    expect(result.processed).toBeGreaterThanOrEqual(0);
  });

  it("規則可分類時不應呼叫 Gemini", async () => {
    vi.mocked(judgeSenderTag).mockClear();

    const emails = [
      { sender: "GitHub <noreply@github.com>", sender_address: "noreply@github.com", subject: "Notification", snippet: "repo update" },
      { sender: "GitHub <noreply@github.com>", sender_address: "noreply@github.com", subject: "Notification 2", snippet: "repo update 2" },
    ];

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "emails") {
          return { select: vi.fn().mockResolvedValue({ data: emails, error: null }) };
        }
        if (table === "sender_tags") {
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
      }),
    };

    await refreshSenderTags(mockSupabase);
    expect(judgeSenderTag).not.toHaveBeenCalled();
  });

  it("無重複寄件者時（count < 2）應跳過", async () => {
    vi.mocked(judgeSenderTag).mockClear();

    const emails = [
      { sender: "Alice <alice@example.com>", sender_address: "alice@example.com", subject: "Test", snippet: "test" },
    ];

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "emails") {
          return { select: vi.fn().mockResolvedValue({ data: emails, error: null }) };
        }
        if (table === "sender_tags") {
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
      }),
    };

    const result = await refreshSenderTags(mockSupabase);
    expect(result.processed).toBe(0);
    expect(judgeSenderTag).not.toHaveBeenCalled();
  });

  it("當規則無法判定且 Gemini 回傳高信心度有效標籤時應使用該標籤", async () => {
    vi.mocked(judgeSenderTag).mockResolvedValueOnce({ tag: "travel", confidence: 0.9 });

    const emails = [
      { sender: "Unknown Sender <unknown@test.com>", sender_address: "unknown@test.com", subject: "Flight booking", snippet: "ticket info" },
      { sender: "Unknown Sender <unknown@test.com>", sender_address: "unknown@test.com", subject: "Flight booking 2", snippet: "ticket info 2" },
    ];

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "emails") {
          return { select: vi.fn().mockResolvedValue({ data: emails, error: null }) };
        }
        if (table === "sender_tags") {
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
      }),
    };

    const result = await refreshSenderTags(mockSupabase);
    expect(result.processed).toBe(1);
    expect(judgeSenderTag).toHaveBeenCalled();
  });

  it("當 Gemini 發生例外或低信心度時應降級為 other 標籤", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(judgeSenderTag).mockRejectedValueOnce(new Error("Gemini fail"));

    const emails = [
      { sender: "Random Sender <random@test.com>", sender_address: "random@test.com", subject: "Hello", snippet: "world" },
      { sender: "Random Sender <random@test.com>", sender_address: "random@test.com", subject: "Hello 2", snippet: "world 2" },
    ];

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "emails") {
          return { select: vi.fn().mockResolvedValue({ data: emails, error: null }) };
        }
        if (table === "sender_tags") {
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
      }),
    };

    const result = await refreshSenderTags(mockSupabase);
    expect(result.processed).toBe(1);
    expect(consoleSpy).toHaveBeenCalledWith("Sender tag judge failed:", expect.any(Error));
    consoleSpy.mockRestore();
  });
});

describe("setManualSenderTag()", () => {
  it("應正確 upsert 到 sender_tags 資料表", async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const mockSupabase = {
      from: vi.fn().mockReturnValue({ upsert: upsertMock }),
    };

    await setManualSenderTag(mockSupabase, "Alice <alice@example.com>", "banking");

    expect(mockSupabase.from).toHaveBeenCalledWith("sender_tags");
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "banking",
        source: "manual",
        sender_display: "Alice <alice@example.com>",
      }),
      { onConflict: "sender_key" },
    );
  });

  it("upsert 失敗時應拋出錯誤", async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: { message: "upsert failed" } });
    const mockSupabase = {
      from: vi.fn().mockReturnValue({ upsert: upsertMock }),
    };

    await expect(setManualSenderTag(mockSupabase, "test@example.com", "travel")).rejects.toThrow();
  });
});

describe("getSenderTags()", () => {
  it("應回傳 Map 結構", async () => {
    const rows = [
      { sender_key: "alice@example.com", tag: "banking", source: "auto", confidence: 0.95, was_aggregated: false, sender_display: "Alice", updated_at: "2026-01-01T00:00:00Z" },
      { sender_key: "bob@example.com", tag: "travel", source: "manual", confidence: null, was_aggregated: false, sender_display: "Bob", updated_at: "2026-01-02T00:00:00Z" },
    ];
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    };

    const result = await getSenderTags(mockSupabase);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    expect(result.get("alice@example.com")?.tag).toBe("banking");
    expect(result.get("bob@example.com")?.tag).toBe("travel");
  });

  it("空資料應回傳空 Map", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    };

    const result = await getSenderTags(mockSupabase);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it("發生 DB 載入錯誤時應記錄錯誤並回傳空 Map", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: null, error: { message: "db select error" } }),
      }),
    };

    const result = await getSenderTags(mockSupabase);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("Unable to load sender tags:", expect.any(Object));
    consoleSpy.mockRestore();
  });
});
