import { describe, it, expect } from "vitest";
import { parseGmailNotification } from "../lib/pubsub";

function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

describe("parseGmailNotification", () => {
  it("應解析標準 Pub/Sub push envelope", () => {
    const result = parseGmailNotification({
      message: {
        data: encode({ emailAddress: "user@gmail.com", historyId: 12345 }),
        messageId: "m1",
        publishTime: "2026-01-01T00:00:00Z",
      },
      subscription: "projects/p/subscriptions/s",
    });

    expect(result).toEqual({ emailAddress: "user@gmail.com", historyId: "12345" });
  });

  it("historyId 為字串時也應正確解析", () => {
    const result = parseGmailNotification({
      message: { data: encode({ emailAddress: "user@gmail.com", historyId: "999" }) },
    });

    expect(result).toEqual({ emailAddress: "user@gmail.com", historyId: "999" });
  });

  it("應接受未包裝的扁平格式（供手動重放使用）", () => {
    const result = parseGmailNotification({ emailAddress: "user@gmail.com", historyId: 777 });

    expect(result).toEqual({ emailAddress: "user@gmail.com", historyId: "777" });
  });

  it("envelope 應優先於頂層欄位", () => {
    const result = parseGmailNotification({
      message: { data: encode({ emailAddress: "inner@gmail.com", historyId: 111 }) },
      emailAddress: "outer@gmail.com",
      historyId: 222,
    });

    expect(result).toEqual({ emailAddress: "inner@gmail.com", historyId: "111" });
  });

  it("message.data 不是合法 base64 JSON 時應回 null，不得退回頂層欄位", () => {
    const result = parseGmailNotification({
      message: { data: "!!!not-valid-json!!!" },
      emailAddress: "outer@gmail.com",
      historyId: 222,
    });

    expect(result).toBeNull();
  });

  it("envelope 內缺少必要欄位時應回 null", () => {
    const result = parseGmailNotification({
      message: { data: encode({ emailAddress: "user@gmail.com" }) },
    });

    expect(result).toBeNull();
  });

  it("頂層缺少必要欄位時應回 null", () => {
    expect(parseGmailNotification({ emailAddress: "user@gmail.com" })).toBeNull();
    expect(parseGmailNotification({ historyId: 123 })).toBeNull();
    expect(parseGmailNotification({})).toBeNull();
  });

  it("空的 emailAddress 或 historyId 應視為無效", () => {
    expect(parseGmailNotification({ emailAddress: "", historyId: 123 })).toBeNull();
    expect(parseGmailNotification({ emailAddress: "user@gmail.com", historyId: "" })).toBeNull();
  });

  it("body 為 null/undefined 時應回 null", () => {
    expect(parseGmailNotification(null)).toBeNull();
    expect(parseGmailNotification(undefined)).toBeNull();
  });
});
