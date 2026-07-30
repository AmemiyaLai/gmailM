import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_BODY_CHARS,
  MAX_STORED_ATTACHMENTS,
  extractAlias,
  fallbackMessageId,
  makeSnippet,
  parseInboundPayload,
  truncateBody,
  type InboundEmailPayload,
} from "../lib/inboundEmail";

const DOMAIN = "autodesignlab.org";

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messageId: "<abc123@mail.example.com>",
    from: { address: "sender@example.com", name: "寄件者" },
    to: ["blog@autodesignlab.org"],
    subject: "測試主旨",
    date: "2026-07-31T01:00:00.000Z",
    text: "純文字內容",
    html: "<p>HTML 內容</p>",
    headers: { "reply-to": "sender@example.com" },
    attachments: [],
    ...overrides,
  };
}

describe("extractAlias", () => {
  it("抽取本網域地址的 local part 並轉小寫", () => {
    expect(extractAlias(["Blog@AutoDesignLab.org"], DOMAIN)).toBe("blog");
  });

  it("去除 +tag 後綴", () => {
    expect(extractAlias(["app+signup@autodesignlab.org"], DOMAIN)).toBe("app");
  });

  it("忽略非本網域的地址，取第一個本網域別名", () => {
    expect(extractAlias(["other@gmail.com", "contact@autodesignlab.org"], DOMAIN)).toBe("contact");
  });

  it("支援「顯示名 <地址>」格式", () => {
    expect(extractAlias(["站點 <blog@autodesignlab.org>"], DOMAIN)).toBe("blog");
  });

  it("非法字元的 local part 回傳 null", () => {
    expect(extractAlias(["漢字@autodesignlab.org"], DOMAIN)).toBeNull();
  });

  it("沒有任何本網域地址時回傳 null", () => {
    expect(extractAlias(["someone@gmail.com"], DOMAIN)).toBeNull();
  });

  it("網域參數為空時回傳 null", () => {
    expect(extractAlias(["blog@autodesignlab.org"], "")).toBeNull();
  });
});

describe("makeSnippet", () => {
  it("優先使用純文字並壓縮空白", () => {
    expect(makeSnippet("哈囉  \n\n 世界", "<p>不採用</p>")).toBe("哈囉 世界");
  });

  it("純文字為空時改從 HTML 去標籤", () => {
    expect(makeSnippet(null, "<style>p{color:red}</style><p>內文 <b>重點</b></p>")).toBe("內文 重點");
  });

  it("超過 200 字時裁切並加省略號", () => {
    const snippet = makeSnippet("a".repeat(300), null);
    expect(snippet.length).toBe(200);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("完全沒有內容時回傳空字串", () => {
    expect(makeSnippet(null, null)).toBe("");
  });
});

describe("fallbackMessageId", () => {
  const payload: InboundEmailPayload = {
    messageId: null,
    from: { address: "a@b.com", name: null },
    to: ["blog@autodesignlab.org"],
    subject: "主旨",
    date: "2026-07-31T01:00:00.000Z",
    text: null,
    html: null,
    headers: {},
    attachments: [],
  };

  it("相同輸入產生相同 id（確定性）", () => {
    expect(fallbackMessageId(payload)).toBe(fallbackMessageId({ ...payload }));
  });

  it("不同主旨產生不同 id", () => {
    expect(fallbackMessageId(payload)).not.toBe(fallbackMessageId({ ...payload, subject: "別的" }));
  });

  it("以 sha256: 開頭", () => {
    expect(fallbackMessageId(payload)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("truncateBody", () => {
  it("null 原樣回傳", () => {
    expect(truncateBody(null)).toEqual({ value: null, truncated: false });
  });

  it("未超限不截斷", () => {
    expect(truncateBody("內容")).toEqual({ value: "內容", truncated: false });
  });

  it("超限時截斷並標記", () => {
    const result = truncateBody("x".repeat(MAX_BODY_CHARS + 10));
    expect(result.truncated).toBe(true);
    expect(result.value?.length).toBe(MAX_BODY_CHARS);
  });
});

describe("parseInboundPayload", () => {
  it("正常 payload 解析成功", () => {
    const result = parseInboundPayload(basePayload(), DOMAIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.email.alias).toBe("blog");
    expect(result.email.messageId).toBe("<abc123@mail.example.com>");
    expect(result.email.fromAddress).toBe("sender@example.com");
    expect(result.email.fromDisplay).toBe("寄件者");
    expect(result.email.snippet).toBe("純文字內容");
    expect(result.email.receivedAt).toBe("2026-07-31T01:00:00.000Z");
  });

  it("非物件 payload 回傳錯誤", () => {
    expect(parseInboundPayload(null, DOMAIN).ok).toBe(false);
    expect(parseInboundPayload([], DOMAIN).ok).toBe(false);
    expect(parseInboundPayload("str", DOMAIN).ok).toBe(false);
  });

  it("缺 from.address 回傳錯誤", () => {
    const result = parseInboundPayload(basePayload({ from: { name: "x" } }), DOMAIN);
    expect(result).toEqual({ ok: false, error: "缺少有效的 from.address" });
  });

  it("缺收件人回傳錯誤", () => {
    const result = parseInboundPayload(basePayload({ to: [] }), DOMAIN);
    expect(result.ok).toBe(false);
  });

  it("收件人皆非本網域時回傳錯誤", () => {
    const result = parseInboundPayload(basePayload({ to: ["x@gmail.com"] }), DOMAIN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(DOMAIN);
  });

  it("Message-ID 缺漏時使用 sha256 fallback", () => {
    const result = parseInboundPayload(basePayload({ messageId: null }), DOMAIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.email.messageId).toMatch(/^sha256:/);
  });

  it("無效日期改用當下時間", () => {
    const before = Date.now();
    const result = parseInboundPayload(basePayload({ date: "not-a-date" }), DOMAIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = new Date(result.email.receivedAt).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
  });

  it("超長內文會被截斷", () => {
    const result = parseInboundPayload(basePayload({ text: "x".repeat(MAX_BODY_CHARS + 5) }), DOMAIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.email.bodyPlain?.length).toBe(MAX_BODY_CHARS);
  });

  it("超大附件降為 metadata（dropped）", () => {
    const result = parseInboundPayload(
      basePayload({
        attachments: [
          { filename: "big.pdf", mimeType: "application/pdf", size: MAX_ATTACHMENT_BYTES + 1, contentBase64: "AAAA", dropped: false },
          { filename: "ok.txt", mimeType: "text/plain", size: 10, contentBase64: "aGVsbG8=", dropped: false },
        ],
      }),
      DOMAIN,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.email.attachments[0]).toMatchObject({ dropped: true, contentBase64: null });
    expect(result.email.attachments[1]).toMatchObject({ dropped: false, contentBase64: "aGVsbG8=" });
  });

  it("超過附件數上限者一律 dropped", () => {
    const attachments = Array.from({ length: MAX_STORED_ATTACHMENTS + 2 }, (_, i) => ({
      filename: `f${i}.txt`,
      mimeType: "text/plain",
      size: 5,
      contentBase64: "aGk=",
      dropped: false,
    }));
    const result = parseInboundPayload(basePayload({ attachments }), DOMAIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.email.attachments.filter((a) => !a.dropped)).toHaveLength(MAX_STORED_ATTACHMENTS);
    expect(result.email.attachments.at(-1)?.dropped).toBe(true);
  });

  it("headers 統一轉小寫鍵並忽略非字串值", () => {
    const result = parseInboundPayload(
      basePayload({ headers: { "Reply-To": "a@b.com", bogus: 123 } }),
      DOMAIN,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.email.headers).toEqual({ "reply-to": "a@b.com" });
  });
});
