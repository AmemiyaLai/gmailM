import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lookupDomains } from "../lib/safeBrowsing";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("SAFE_BROWSING_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("lookupDomains", () => {
  it("空回應應將所有送查網域視為乾淨", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));

    const result = await lookupDomains(["apple.com", "example.com"]);
    expect(result.get("apple.com")?.verdict).toBe("clean");
    expect(result.get("example.com")?.verdict).toBe("clean");
  });

  it("命中的網域應為 threat，其餘維持 clean", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        matches: [
          {
            threatType: "SOCIAL_ENGINEERING",
            threat: { url: "http://bad.example/login" },
            cacheDuration: "600s",
          },
        ],
      }),
    );

    const result = await lookupDomains(["bad.example", "apple.com"]);
    const bad = result.get("bad.example");
    expect(bad?.verdict).toBe("threat");
    expect(bad?.threatTypes).toEqual(["SOCIAL_ENGINEERING"]);
    expect(bad?.cacheSeconds).toBe(600);
    expect(result.get("apple.com")?.verdict).toBe("clean");
  });

  it("金鑰未設定時應回傳 unknown 且不呼叫 fetch", async () => {
    vi.stubEnv("SAFE_BROWSING_API_KEY", "");

    const result = await lookupDomains(["apple.com"]);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.get("apple.com")?.verdict).toBe("unknown");
    expect(result.get("apple.com")?.errorMessage).toContain("未設定");
  });

  it("HTTP 429 應回傳 error 並註明配額不足", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 429));

    const result = await lookupDomains(["apple.com"]);
    expect(result.get("apple.com")?.verdict).toBe("error");
    expect(result.get("apple.com")?.errorMessage).toContain("配額不足");
  });

  it("其他非 2xx 應回傳 error", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 500));
    const result = await lookupDomains(["apple.com"]);
    expect(result.get("apple.com")?.verdict).toBe("error");
  });

  it("JSON 解析失敗應回傳 error 而非拋出例外", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token");
      },
    });

    const result = await lookupDomains(["apple.com"]);
    expect(result.get("apple.com")?.verdict).toBe("error");
  });

  it("fetch 拋出例外時不應向外拋出", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    const result = await lookupDomains(["apple.com"]);
    expect(result.get("apple.com")?.verdict).toBe("error");
    expect(result.get("apple.com")?.errorMessage).toBe("network down");
  });

  it("超過單批上限時應分批送出", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));

    const domains = Array.from({ length: 120 }, (_, i) => `d${i}.example`);
    const result = await lookupDomains(domains);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.size).toBe(120);
  });

  it("應正規化並去重輸入網域，且送出正確的 request body", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));

    await lookupDomains(["Apple.COM.", "apple.com", "  "]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("threatMatches:find?key=test-key");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.threatInfo.threatEntries).toEqual([{ url: "apple.com" }]);
    expect(body.threatInfo.threatTypes).toContain("SOCIAL_ENGINEERING");
  });

  it("空輸入應回傳空 Map 且不呼叫 fetch", async () => {
    const result = await lookupDomains([]);
    expect(result.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
