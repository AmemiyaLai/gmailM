import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/supabase", () => ({
  getSupabase: vi.fn(() => ({})),
}));

vi.mock("../../../lib/senderTagService", () => ({
  setManualSenderTag: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/senderTags", () => ({
  isSenderTag: vi.fn((v: unknown) =>
    typeof v === "string" && ["banking", "securities", "commerce", "development", "media", "learning", "travel", "security", "other"].includes(v),
  ),
}));

import { POST } from "../../../pages/api/senders/tag";
import { setManualSenderTag } from "../../../lib/senderTagService";
import { getSupabase } from "../../../lib/supabase";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/senders/tag", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/senders/tag", () => {
  beforeEach(() => vi.clearAllMocks());

  it("有效 sender 和 tag 應回傳 200", async () => {
    const res = await POST({ request: makeRequest({ sender: "alice@example.com", tag: "banking" }) } as never);
    expect(res.status).toBe(200);
    expect(setManualSenderTag).toHaveBeenCalled();
  });

  it("缺少 sender 應回傳 400", async () => {
    const res = await POST({ request: makeRequest({ tag: "banking" }) } as never);
    expect(res.status).toBe(400);
  });

  it("無效 tag 應回傳 400", async () => {
    const res = await POST({ request: makeRequest({ sender: "a@b.com", tag: "invalid" }) } as never);
    expect(res.status).toBe(400);
  });

  it("setManualSenderTag 拋出例外時應回傳 500", async () => {
    vi.mocked(setManualSenderTag).mockRejectedValueOnce(new Error("db error"));
    const res = await POST({ request: makeRequest({ sender: "a@b.com", tag: "travel" }) } as never);
    expect(res.status).toBe(500);
  });

  it("無效 JSON body 應回傳 500", async () => {
    const req = new Request("http://localhost/api/senders/tag", {
      method: "POST",
      body: "not json",
    });
    const res = await POST({ request: req } as never);
    expect(res.status).toBe(500);
  });
});
