import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLookupDomains = vi.fn();
vi.mock("../lib/safeBrowsing", () => ({
  lookupDomains: (...args: unknown[]) => mockLookupDomains(...args),
}));

import { getDomainReputations } from "../lib/domainReputation";

const mockUpsert = vi.fn();
let cachedRows: unknown[] = [];

function makeSupabase() {
  const query: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gt: vi.fn(() => Promise.resolve({ data: cachedRows, error: null })),
    upsert: mockUpsert,
  };
  return { from: vi.fn(() => query), query };
}

function lookup(domain: string, overrides: Record<string, unknown> = {}) {
  return {
    domain,
    verdict: "clean",
    threatTypes: [],
    cacheSeconds: null,
    errorMessage: null,
    raw: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cachedRows = [];
  mockUpsert.mockResolvedValue({ error: null });
  mockLookupDomains.mockResolvedValue(new Map());
});

describe("getDomainReputations", () => {
  it("空輸入應回傳空 Map 且不查詢", async () => {
    const supabase = makeSupabase();
    const result = await getDomainReputations(supabase as never, []);
    expect(result.size).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mockLookupDomains).not.toHaveBeenCalled();
  });

  it("快取未過期時應直接命中且不呼叫外部 API", async () => {
    cachedRows = [
      {
        domain: "apple.com",
        verdict: "clean",
        threat_types: [],
        error_message: null,
        checked_at: "2026-07-30T00:00:00.000Z",
        expires_at: "2026-08-30T00:00:00.000Z",
      },
    ];
    const supabase = makeSupabase();

    const result = await getDomainReputations(supabase as never, ["apple.com"]);
    expect(result.get("apple.com")?.verdict).toBe("clean");
    expect(mockLookupDomains).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("快取未命中時應查詢外部 API 並寫回", async () => {
    mockLookupDomains.mockResolvedValue(new Map([["example.com", lookup("example.com")]]));
    const supabase = makeSupabase();

    const result = await getDomainReputations(supabase as never, ["example.com"]);
    expect(mockLookupDomains).toHaveBeenCalledWith(["example.com"]);
    expect(result.get("example.com")?.verdict).toBe("clean");
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [rows, options] = mockUpsert.mock.calls[0];
    expect(options).toEqual({ onConflict: "domain" });
    expect(rows[0]).toMatchObject({ domain: "example.com", provider: "google_safe_browsing" });
  });

  it("clean 應套用 7 天 TTL", async () => {
    mockLookupDomains.mockResolvedValue(new Map([["a.example", lookup("a.example")]]));
    const supabase = makeSupabase();

    await getDomainReputations(supabase as never, ["a.example"]);
    const row = mockUpsert.mock.calls[0][0][0];
    const ttl = new Date(row.expires_at).getTime() - new Date(row.checked_at).getTime();
    expect(ttl).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("threat 應以 cacheDuration 為 TTL 且不低於 5 分鐘", async () => {
    mockLookupDomains.mockResolvedValue(
      new Map([
        ["b.example", lookup("b.example", { verdict: "threat", cacheSeconds: 60, threatTypes: ["MALWARE"] })],
      ]),
    );
    const supabase = makeSupabase();

    await getDomainReputations(supabase as never, ["b.example"]);
    const row = mockUpsert.mock.calls[0][0][0];
    const ttl = new Date(row.expires_at).getTime() - new Date(row.checked_at).getTime();
    expect(ttl).toBe(5 * 60 * 1000);
    expect(row.threat_types).toEqual(["MALWARE"]);
  });

  it("error 應只套用 1 小時的短退避 TTL", async () => {
    mockLookupDomains.mockResolvedValue(
      new Map([["c.example", lookup("c.example", { verdict: "error", errorMessage: "配額不足" })]]),
    );
    const supabase = makeSupabase();

    const result = await getDomainReputations(supabase as never, ["c.example"]);
    const row = mockUpsert.mock.calls[0][0][0];
    const ttl = new Date(row.expires_at).getTime() - new Date(row.checked_at).getTime();
    expect(ttl).toBe(60 * 60 * 1000);
    expect(result.get("c.example")?.errorMessage).toBe("配額不足");
  });

  it("外部 API 未回傳某網域時應標記為 unknown", async () => {
    mockLookupDomains.mockResolvedValue(new Map());
    const supabase = makeSupabase();

    const result = await getDomainReputations(supabase as never, ["d.example"]);
    expect(result.get("d.example")?.verdict).toBe("unknown");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("應保留既有快取並只對未命中網域查詢", async () => {
    cachedRows = [
      {
        domain: "apple.com",
        verdict: "clean",
        threat_types: [],
        error_message: null,
        checked_at: "2026-07-30T00:00:00.000Z",
        expires_at: "2026-08-30T00:00:00.000Z",
      },
    ];
    mockLookupDomains.mockResolvedValue(new Map([["new.example", lookup("new.example")]]));
    const supabase = makeSupabase();

    const result = await getDomainReputations(supabase as never, ["apple.com", "new.example"]);
    expect(mockLookupDomains).toHaveBeenCalledWith(["new.example"]);
    expect(result.size).toBe(2);
  });

  it("寫入快取失敗不應影響回傳結果", async () => {
    mockLookupDomains.mockResolvedValue(new Map([["e.example", lookup("e.example")]]));
    mockUpsert.mockResolvedValue({ error: { message: "boom" } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = makeSupabase();

    const result = await getDomainReputations(supabase as never, ["e.example"]);
    expect(result.get("e.example")?.verdict).toBe("clean");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("應正規化並去重輸入網域", async () => {
    mockLookupDomains.mockResolvedValue(new Map([["apple.com", lookup("apple.com")]]));
    const supabase = makeSupabase();

    await getDomainReputations(supabase as never, ["Apple.COM.", "apple.com"]);
    expect(supabase.query.in).toHaveBeenCalledWith("domain", ["apple.com"]);
  });
});
