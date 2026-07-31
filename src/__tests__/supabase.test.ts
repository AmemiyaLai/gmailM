import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: vi.fn(), auth: {} })),
}));

describe("supabase.ts", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("環境變數無效時應回傳 mock client", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const { getSupabase } = await import("../lib/supabase");
    const client = getSupabase();
    expect(client).toBeDefined();
    expect(client.from).toBeDefined();
  });

  it("SUPABASE_URL 為佔位符時應回傳 mock client", async () => {
    vi.stubEnv("SUPABASE_URL", "https://your-project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "some-key");

    const { getSupabase } = await import("../lib/supabase");
    const client = getSupabase();
    expect(client).toBeDefined();
  });

  it("SUPABASE_SERVICE_ROLE_KEY 為佔位符時應回傳 mock client", async () => {
    vi.stubEnv("SUPABASE_URL", "https://valid.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "your_service_role_key_here");

    const { getSupabase } = await import("../lib/supabase");
    const client = getSupabase();
    expect(client).toBeDefined();
  });

  it("有效的環境變數應建立真實 client", async () => {
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "real-key-123");

    const { getSupabase } = await import("../lib/supabase");
    const client = getSupabase();
    expect(client).toBeDefined();
    const { createClient } = await import("@supabase/supabase-js");
    expect(createClient).toHaveBeenCalledWith(
      "https://abc.supabase.co",
      "real-key-123",
    );
  });

  it("mock client 的 from().select() 應可鏈式呼叫", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const { getSupabase } = await import("../lib/supabase");
    const client = getSupabase();

    const result = await client.from("emails").select("id");
    expect(result).toBeDefined();
    expect(result.data).toEqual([]);
    expect(result.count).toBe(0);
  });

  it("mock client 的 single() 應回傳 null data", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const { getSupabase } = await import("../lib/supabase");
    const client = getSupabase();

    const result = await client.from("emails").select("id").single();
    expect(result).toBeDefined();
    expect(result.data).toBeNull();
  });

  it("mock client 的 maybeSingle() 應回傳 null data", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const { getSupabase } = await import("../lib/supabase");
    const client = getSupabase();

    const result = await client.from("emails").select("id").maybeSingle();
    expect(result).toBeDefined();
    expect(result.data).toBeNull();
  });
});

describe("unwrapQuery()", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("沒有錯誤時應原樣回傳 data", async () => {
    const { unwrapQuery } = await import("../lib/supabase");
    const rows = [{ id: "a" }];
    expect(unwrapQuery({ data: rows, error: null }, "test")).toBe(rows);
  });

  it("data 為 null 且無錯誤時應回傳 null", async () => {
    const { unwrapQuery } = await import("../lib/supabase");
    expect(unwrapQuery({ data: null, error: null }, "test")).toBeNull();
  });

  it("有錯誤時應拋出並帶上發生位置與原始訊息", async () => {
    const { unwrapQuery, SupabaseQueryError } = await import("../lib/supabase");

    expect(() =>
      unwrapQuery({ data: null, error: { message: "relation does not exist" } }, "listKeywords"),
    ).toThrow(SupabaseQueryError);

    // 錯誤訊息要同時包含位置與原因，才能直接從畫面上判斷該做什麼
    expect(() =>
      unwrapQuery({ data: null, error: { message: "relation does not exist" } }, "listKeywords"),
    ).toThrow(/listKeywords.*relation does not exist/);
  });

  it("即使同時有 data 與 error 也應以 error 為準拋出", async () => {
    const { unwrapQuery } = await import("../lib/supabase");
    expect(() => unwrapQuery({ data: [{ id: "a" }], error: { message: "partial failure" } }, "test")).toThrow();
  });
});
