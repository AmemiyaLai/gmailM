import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/supabase", () => ({
  getSupabase: vi.fn(),
}));

vi.mock("../../../lib/senderTagService", () => ({
  refreshSenderTags: vi.fn().mockResolvedValue({ processed: 5, aggregated: 1 }),
}));

import { GET, POST } from "../../../pages/api/senders/tags/refresh";
import { getSupabase } from "../../../lib/supabase";
import { refreshSenderTags } from "../../../lib/senderTagService";

describe("GET /api/senders/tags/refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("應回傳所有 sender tags", async () => {
    const tags = [
      { sender_key: "a@b.com", tag: "banking", source: "auto", confidence: 0.9, was_aggregated: false, sender_display: "A", updated_at: "2026-01-01" },
    ];
    vi.mocked(getSupabase).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: tags, error: null }),
      }),
    } as never);

    const res = await GET({} as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags).toHaveLength(1);
  });

  it("DB 錯誤時應回傳 500", async () => {
    vi.mocked(getSupabase).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } }),
      }),
    } as never);

    const res = await GET({} as never);
    expect(res.status).toBe(500);
  });
});

describe("POST /api/senders/tags/refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("應觸發 refreshSenderTags 並回傳結果", async () => {
    const res = await POST({} as never);
    expect(res.status).toBe(200);
    expect(refreshSenderTags).toHaveBeenCalled();
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.processed).toBe(5);
  });

  it("refreshSenderTags 失敗時應回傳 500", async () => {
    vi.mocked(refreshSenderTags).mockRejectedValueOnce(new Error("refresh failed"));
    const res = await POST({} as never);
    expect(res.status).toBe(500);
  });
});
