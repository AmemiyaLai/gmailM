import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";

const { mockApproveReview, mockRejectReview, mockGetReview } = vi.hoisted(() => ({
  mockApproveReview: vi.fn(),
  mockRejectReview: vi.fn(),
  mockGetReview: vi.fn(),
}));

vi.mock("../../../lib/cleanupReview", () => ({
  approveReview: mockApproveReview,
  rejectReview: mockRejectReview,
  getReview: mockGetReview,
}));

import { POST } from "../../../pages/api/discord/interactions";

// 產生一組 ed25519 金鑰模擬 Discord Application 的簽章
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyHex = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");

function makeContext(body: unknown, opts: { signed?: boolean; timestamp?: string } = {}) {
  const { signed = true, timestamp = "1700000000" } = opts;
  const raw = JSON.stringify(body);
  const signature = signed
    ? cryptoSign(null, Buffer.from(timestamp + raw), privateKey).toString("hex")
    : "00".repeat(64);

  const request = new Request("http://localhost/api/discord/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature-ed25519": signature,
      "x-signature-timestamp": timestamp,
    },
    body: raw,
  });
  return { request } as never;
}

describe("POST /api/discord/interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DISCORD_PUBLIC_KEY", publicKeyHex);
  });

  it("未設定 DISCORD_PUBLIC_KEY 時應回傳 500", async () => {
    vi.stubEnv("DISCORD_PUBLIC_KEY", "");
    const res = await POST(makeContext({ type: 1 }));
    expect(res.status).toBe(500);
  });

  it("簽章錯誤時應回傳 401", async () => {
    const res = await POST(makeContext({ type: 1 }, { signed: false }));
    expect(res.status).toBe(401);
  });

  it("缺少簽章 header 時應回傳 401", async () => {
    const request = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      body: JSON.stringify({ type: 1 }),
    });
    const res = await POST({ request } as never);
    expect(res.status).toBe(401);
  });

  it("PING 應回傳 type 1", async () => {
    const res = await POST(makeContext({ type: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it("按下確認刪除應呼叫 approveReview 並就地更新訊息且移除按鈕", async () => {
    mockApproveReview.mockResolvedValue({ status: "approved", action: "trash", processedCount: 3, failedCount: 0 });

    const res = await POST(
      makeContext({ type: 3, data: { custom_id: "cleanup:approve:review-1" } }),
    );

    expect(mockApproveReview).toHaveBeenCalledWith("review-1");
    const body = await res.json();
    expect(body.type).toBe(7);
    expect(body.data.components).toEqual([]);
    expect(body.data.embeds[0].description).toContain("3 封");
    expect(body.data.embeds[0].description).toContain("垃圾桶");
  });

  it("按下標記已讀應呼叫 approveReview 並顯示已讀文案", async () => {
    mockApproveReview.mockResolvedValue({ status: "approved", action: "read", processedCount: 5, failedCount: 0 });

    const res = await POST(
      makeContext({ type: 3, data: { custom_id: "cleanup:approve:review-2" } }),
    );

    const body = await res.json();
    expect(body.data.embeds[0].description).toContain("5 封");
    expect(body.data.embeds[0].description).toContain("已讀");
  });

  it("按下取消應呼叫 rejectReview", async () => {
    mockRejectReview.mockResolvedValue({ status: "rejected", action: "trash", emailCount: 2 });

    const res = await POST(
      makeContext({ type: 3, data: { custom_id: "cleanup:reject:review-1" } }),
    );

    expect(mockRejectReview).toHaveBeenCalledWith("review-1");
    const body = await res.json();
    expect(body.type).toBe(7);
    expect(body.data.embeds[0].description).toContain("已取消");
  });

  it("重複點擊應顯示已處理過", async () => {
    mockApproveReview.mockResolvedValue({ status: "already-handled" });
    mockGetReview.mockResolvedValue({ action: "trash" });

    const res = await POST(
      makeContext({ type: 3, data: { custom_id: "cleanup:approve:review-1" } }),
    );

    const body = await res.json();
    expect(body.data.embeds[0].description).toContain("已經處理過");
  });

  it("非 cleanup 的 custom_id 應以 ephemeral 訊息忽略", async () => {
    const res = await POST(makeContext({ type: 3, data: { custom_id: "other:foo:1" } }));
    const body = await res.json();
    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(mockApproveReview).not.toHaveBeenCalled();
  });

  it("不支援的互動類型應回 ephemeral 訊息", async () => {
    const res = await POST(makeContext({ type: 2 }));
    const body = await res.json();
    expect(body.type).toBe(4);
  });

  it("處理過程丟出錯誤時應回 ephemeral 訊息而非 500", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockApproveReview.mockRejectedValue(new Error("DB down"));

    const res = await POST(
      makeContext({ type: 3, data: { custom_id: "cleanup:approve:review-1" } }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.content).toContain("處理失敗");
    consoleSpy.mockRestore();
  });

  it("Invalid JSON body 應回傳 400", async () => {
    const raw = "not-json{{{";
    const ts = "1700000000";
    const sig = cryptoSign(null, Buffer.from(ts + raw), privateKey).toString("hex");
    const request = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      headers: {
        "x-signature-ed25519": sig,
        "x-signature-timestamp": ts,
      },
      body: raw,
    });
    const res = await POST({ request } as never);
    expect(res.status).toBe(400);
  });

  it("取消按鈕重複點擊（already-handled）應顯示已處理過", async () => {
    mockRejectReview.mockResolvedValue({ status: "already-handled" });
    mockGetReview.mockResolvedValue({ action: "read" });

    const res = await POST(
      makeContext({ type: 3, data: { custom_id: "cleanup:reject:review-1" } }),
    );

    const body = await res.json();
    expect(body.data.embeds[0].description).toContain("已經處理過");
  });

  it("無法辨識的按鈕動作應回 ephemeral 訊息", async () => {
    const res = await POST(
      makeContext({ type: 3, data: { custom_id: "cleanup:unknown:review-1" } }),
    );

    const body = await res.json();
    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(body.data.content).toContain("無法辨識");
  });
});
