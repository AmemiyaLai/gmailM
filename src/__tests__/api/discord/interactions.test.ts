import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";

const {
  mockApproveReview, mockRejectReview, mockGetReview,
  mockEditInteractionMessage, mockWaitUntil,
} = vi.hoisted(() => ({
  mockApproveReview: vi.fn(),
  mockRejectReview: vi.fn(),
  mockGetReview: vi.fn(),
  mockEditInteractionMessage: vi.fn().mockResolvedValue(undefined),
  mockWaitUntil: vi.fn(),
}));

vi.mock("../../../lib/cleanupReview", () => ({
  approveReview: mockApproveReview,
  rejectReview: mockRejectReview,
  getReview: mockGetReview,
}));

vi.mock("../../../lib/discord", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/discord")>("../../../lib/discord");
  return {
    buildCleanupResultEmbed: actual.buildCleanupResultEmbed,
    editInteractionMessage: mockEditInteractionMessage,
  };
});

vi.mock("@vercel/functions", () => ({ waitUntil: mockWaitUntil }));

import { POST } from "../../../pages/api/discord/interactions";

// 產生一組 ed25519 金鑰模擬 Discord Application 的簽章
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyHex = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");

const APP_ID = "app-1";
const TOKEN = "interaction-token-1";

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

/** 元件互動的標準 payload */
function componentInteraction(customId: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 3,
    application_id: APP_ID,
    token: TOKEN,
    data: { custom_id: customId },
    ...overrides,
  };
}

describe("POST /api/discord/interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DISCORD_PUBLIC_KEY", publicKeyHex);
    // 預設走 Vercel 目標，避免受外部環境的 DEPLOY_TARGET 影響
    vi.stubEnv("DEPLOY_TARGET", "");
    mockEditInteractionMessage.mockResolvedValue(undefined);
    // 預設模擬非 Vercel 環境：waitUntil 不可用 → route 會同步等背景工作完成，
    // 讓測試能直接斷言回寫結果。
    mockWaitUntil.mockImplementation(() => {
      throw new Error("waitUntil is not available");
    });
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

  it("按鈕互動應立刻回 deferred（type 6）而非等處理完才回應", async () => {
    mockApproveReview.mockResolvedValue({ status: "approved", action: "trash", processedCount: 3, failedCount: 0 });

    const res = await POST(makeContext(componentInteraction("cleanup:approve:review-1")));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 6 });
  });

  it("Vercel 環境下應把處理交給 waitUntil，不阻塞回應", async () => {
    mockWaitUntil.mockImplementation(() => undefined); // 模擬 Vercel：排程成功
    let resolveApprove: (v: unknown) => void = () => {};
    mockApproveReview.mockReturnValue(new Promise((r) => { resolveApprove = r; }));

    // 即使處理還沒完成，仍應立即回應
    const res = await POST(makeContext(componentInteraction("cleanup:approve:review-1")));

    expect(await res.json()).toEqual({ type: 6 });
    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
    expect(mockEditInteractionMessage).not.toHaveBeenCalled();

    resolveApprove({ status: "approved", action: "trash", processedCount: 1, failedCount: 0 });
  });

  it("自托管環境應直接背景執行，不呼叫 waitUntil 也不阻塞回應", async () => {
    vi.stubEnv("DEPLOY_TARGET", "node");
    // waitUntil 在自托管下不該被碰到；若被呼叫會拋錯而讓測試失敗
    mockApproveReview.mockReturnValue(new Promise(() => {})); // 永不 resolve

    const res = await POST(makeContext(componentInteraction("cleanup:approve:review-1")));

    expect(await res.json()).toEqual({ type: 6 });
    expect(mockWaitUntil).not.toHaveBeenCalled();
    expect(mockEditInteractionMessage).not.toHaveBeenCalled();
  });

  it("確認刪除完成後應回寫訊息並移除按鈕", async () => {
    mockApproveReview.mockResolvedValue({ status: "approved", action: "trash", processedCount: 3, failedCount: 0 });

    await POST(makeContext(componentInteraction("cleanup:approve:review-1")));

    expect(mockApproveReview).toHaveBeenCalledWith("review-1");
    const [appId, token, embed] = mockEditInteractionMessage.mock.calls[0];
    expect(appId).toBe(APP_ID);
    expect(token).toBe(TOKEN);
    expect(embed.description).toContain("3 封");
    expect(embed.description).toContain("垃圾桶");
  });

  it("標記已讀完成後應使用已讀文案", async () => {
    mockApproveReview.mockResolvedValue({ status: "approved", action: "read", processedCount: 5, failedCount: 0 });

    await POST(makeContext(componentInteraction("cleanup:approve:review-2")));

    const embed = mockEditInteractionMessage.mock.calls[0][2];
    expect(embed.description).toContain("5 封");
    expect(embed.description).toContain("已讀");
  });

  it("按下取消應呼叫 rejectReview 並回寫取消文案", async () => {
    mockRejectReview.mockResolvedValue({ status: "rejected", action: "trash", emailCount: 2 });

    await POST(makeContext(componentInteraction("cleanup:reject:review-1")));

    expect(mockRejectReview).toHaveBeenCalledWith("review-1");
    const embed = mockEditInteractionMessage.mock.calls[0][2];
    expect(embed.description).toContain("已取消");
    expect(embed.description).toContain("2 封");
  });

  it("重複點擊應查回原 action 並顯示已處理過", async () => {
    mockApproveReview.mockResolvedValue({ status: "already-handled" });
    mockGetReview.mockResolvedValue({ action: "read" });

    await POST(makeContext(componentInteraction("cleanup:approve:review-1")));

    const embed = mockEditInteractionMessage.mock.calls[0][2];
    expect(embed.description).toContain("已經處理過");
    expect(embed.title).toContain("標記已讀"); // 用查回來的 action 決定標題
  });

  it("查不到審核單時仍應回寫已處理過訊息", async () => {
    mockRejectReview.mockResolvedValue({ status: "already-handled" });
    mockGetReview.mockResolvedValue(null);

    await POST(makeContext(componentInteraction("cleanup:reject:review-1")));

    const embed = mockEditInteractionMessage.mock.calls[0][2];
    expect(embed.description).toContain("已經處理過");
  });

  it("處理過程丟出錯誤時應回寫錯誤提示，且回應仍是 deferred", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockApproveReview.mockRejectedValue(new Error("DB down"));

    const res = await POST(makeContext(componentInteraction("cleanup:approve:review-1")));

    expect(await res.json()).toEqual({ type: 6 });
    const embed = mockEditInteractionMessage.mock.calls[0][2];
    expect(embed.description).toContain("發生錯誤");
    consoleSpy.mockRestore();
  });

  it("連錯誤訊息都回寫失敗時不應讓例外逸出", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockApproveReview.mockRejectedValue(new Error("DB down"));
    mockEditInteractionMessage.mockRejectedValue(new Error("Discord 502"));

    const res = await POST(makeContext(componentInteraction("cleanup:approve:review-1")));

    expect(await res.json()).toEqual({ type: 6 });
    consoleSpy.mockRestore();
  });

  it("缺少 application_id 或 token 時應回 ephemeral 而不處理", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      makeContext({ type: 3, token: TOKEN, data: { custom_id: "cleanup:approve:review-1" } }),
    );

    const body = await res.json();
    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(mockApproveReview).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("非 cleanup 的 custom_id 應以 ephemeral 訊息忽略", async () => {
    const res = await POST(makeContext(componentInteraction("other:foo:1")));
    const body = await res.json();
    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(mockApproveReview).not.toHaveBeenCalled();
  });

  it("cleanup 但動作無法辨識時應以 ephemeral 訊息忽略", async () => {
    const res = await POST(makeContext(componentInteraction("cleanup:explode:review-1")));
    const body = await res.json();
    expect(body.type).toBe(4);
    expect(mockApproveReview).not.toHaveBeenCalled();
    expect(mockRejectReview).not.toHaveBeenCalled();
  });

  it("不支援的互動類型應回 ephemeral 訊息", async () => {
    const res = await POST(makeContext({ type: 2 }));
    const body = await res.json();
    expect(body.type).toBe(4);
  });

  it("body 不是合法 JSON 時應回 400", async () => {
    const timestamp = "1700000000";
    const raw = "not json";
    const signature = cryptoSign(null, Buffer.from(timestamp + raw), privateKey).toString("hex");
    const request = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      headers: {
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      body: raw,
    });

    const res = await POST({ request } as never);
    expect(res.status).toBe(400);
  });
});
