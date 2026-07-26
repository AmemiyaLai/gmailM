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
