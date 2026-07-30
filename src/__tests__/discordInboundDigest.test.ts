import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { sendInboundDigest, type InboundDigestPayload } from "../lib/discord";

function payload(overrides: Partial<InboundDigestPayload> = {}): InboundDigestPayload {
  return {
    total: 3,
    unreadTotal: 2,
    perAlias: [
      { alias: "blog", label: "部落格", count: 2 },
      { alias: "app", label: "未分類", count: 1 },
    ],
    topSenders: [{ fromAddress: "a@x.com", count: 2 }],
    notableSubjects: ["主旨一", "主旨二"],
    periodStart: new Date("2026-07-30T23:00:00Z"),
    periodEnd: new Date("2026-07-31T12:00:00Z"),
    ...overrides,
  };
}

describe("sendInboundDigest()", () => {
  beforeEach(() => {
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc");
    vi.stubEnv("SITE_URL", "https://gmailm.autodesignlab.org");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("應向 Discord webhook 發送含統計欄位的 embed", async () => {
    await sendInboundDigest(payload());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const embed = body.embeds[0];

    expect(embed.title).toBe("📮 站點收件匣摘要");
    expect(embed.description).toContain("**3**");
    expect(embed.description).toContain("**2**");
    expect(embed.url).toBe("https://gmailm.autodesignlab.org/inbound");

    const fieldNames = embed.fields.map((f: { name: string }) => f.name);
    expect(fieldNames).toContain("各別名統計");
    expect(fieldNames).toContain("常見寄件者");
    expect(fieldNames).toContain("最新主旨");
    expect(fieldNames).toContain("管理頁面");

    const aliasField = embed.fields.find((f: { name: string }) => f.name === "各別名統計");
    expect(aliasField.value).toContain("`blog`（部落格）× 2");
  });

  it("空統計清單時省略對應欄位", async () => {
    await sendInboundDigest(payload({ perAlias: [], topSenders: [], notableSubjects: [] }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const fieldNames = body.embeds[0].fields.map((f: { name: string }) => f.name);
    expect(fieldNames).not.toContain("各別名統計");
    expect(fieldNames).not.toContain("常見寄件者");
    expect(fieldNames).not.toContain("最新主旨");
    expect(fieldNames).toContain("涵蓋期間");
  });

  it("超長欄位內容裁切至 1024 字元", async () => {
    const manyAliases = Array.from({ length: 100 }, (_, i) => ({
      alias: `alias-${i}`,
      label: "標籤".repeat(10),
      count: i,
    }));
    await sendInboundDigest(payload({ perAlias: manyAliases }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const aliasField = body.embeds[0].fields.find((f: { name: string }) => f.name === "各別名統計");
    expect(aliasField.value.length).toBeLessThanOrEqual(1024);
    expect(aliasField.value.endsWith("…")).toBe(true);
  });

  it("未設定 DISCORD_WEBHOOK_URL 時不發送", async () => {
    vi.stubEnv("DISCORD_WEBHOOK_URL", "");
    await sendInboundDigest(payload());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Discord 回應非 2xx 時拋出錯誤", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    await expect(sendInboundDigest(payload())).rejects.toThrow("Discord webhook failed (429)");
  });
});
