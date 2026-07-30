import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_PAYLOAD_BYTES } from "../../../lib/inboundEmail";

vi.stubEnv("INBOUND_EMAIL_WEBHOOK_SECRET", "test-webhook-secret");
vi.stubEnv("INBOUND_EMAIL_DOMAIN", "autodesignlab.org");

const {
  mockGetSupabase,
  mockEnsureAlias,
  mockFindDuplicate,
  mockSaveInboundEmail,
  mockUploadAttachments,
} = vi.hoisted(() => ({
  mockGetSupabase: vi.fn(),
  mockEnsureAlias: vi.fn(),
  mockFindDuplicate: vi.fn(),
  mockSaveInboundEmail: vi.fn(),
  mockUploadAttachments: vi.fn(),
}));

vi.mock("../../../lib/supabase", () => ({
  getSupabase: mockGetSupabase,
}));

vi.mock("../../../lib/inboundEmailService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/inboundEmailService")>()),
  ensureAlias: mockEnsureAlias,
  findDuplicateInboundEmail: mockFindDuplicate,
  saveInboundEmail: mockSaveInboundEmail,
  uploadInboundAttachments: mockUploadAttachments,
}));

import { POST } from "../../../pages/api/webhook/inbound-email";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    messageId: "<m1@example.com>",
    from: { address: "sender@example.com", name: "寄件者" },
    to: ["blog@autodesignlab.org"],
    subject: "測試",
    date: "2026-07-31T01:00:00.000Z",
    text: "內容",
    html: null,
    headers: {},
    attachments: [],
    ...overrides,
  };
}

function makeContext(options: { auth?: string; body?: unknown; rawBody?: string; contentLength?: string } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.auth) headers.set("authorization", options.auth);
  if (options.contentLength) headers.set("content-length", options.contentLength);
  const body = options.rawBody ?? JSON.stringify(options.body ?? validBody());
  return {
    request: new Request("http://localhost/api/webhook/inbound-email", {
      method: "POST",
      headers,
      body,
    }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSupabase.mockReturnValue({ from: vi.fn(), storage: { from: vi.fn() } });
  mockFindDuplicate.mockResolvedValue(null);
  mockEnsureAlias.mockResolvedValue(undefined);
  mockUploadAttachments.mockResolvedValue([]);
  mockSaveInboundEmail.mockImplementation(async (_s: unknown, id: string) => ({ id, duplicate: false }));
});

describe("POST /api/webhook/inbound-email", () => {
  it("無 Authorization header 應回傳 401", async () => {
    const res = await POST(makeContext());
    expect(res.status).toBe(401);
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  it("Bearer token 錯誤時應回傳 401", async () => {
    const res = await POST(makeContext({ auth: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("Content-Length 超過上限應回傳 413", async () => {
    const res = await POST(
      makeContext({ auth: "Bearer test-webhook-secret", contentLength: String(MAX_PAYLOAD_BYTES + 1) }),
    );
    expect(res.status).toBe(413);
  });

  it("無效 JSON 應回傳 400", async () => {
    const res = await POST(makeContext({ auth: "Bearer test-webhook-secret", rawBody: "not json" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "無效的 JSON" });
  });

  it("別名抽取失敗應回傳 400 且不落庫", async () => {
    const res = await POST(
      makeContext({ auth: "Bearer test-webhook-secret", body: validBody({ to: ["x@gmail.com"] }) }),
    );
    expect(res.status).toBe(400);
    expect(mockSaveInboundEmail).not.toHaveBeenCalled();
  });

  it("重複 Message-ID 應回傳 200 duplicate 且不再寫入", async () => {
    mockFindDuplicate.mockResolvedValue("uuid-existing");

    const res = await POST(makeContext({ auth: "Bearer test-webhook-secret" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok", id: "uuid-existing", duplicate: true });
    expect(mockEnsureAlias).not.toHaveBeenCalled();
    expect(mockSaveInboundEmail).not.toHaveBeenCalled();
  });

  it("成功時依序查重、登記別名、上傳附件、寫入", async () => {
    const res = await POST(
      makeContext({
        auth: "Bearer test-webhook-secret",
        body: validBody({
          attachments: [
            { filename: "a.txt", mimeType: "text/plain", size: 5, contentBase64: "aGVsbG8=", dropped: false },
          ],
        }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.duplicate).toBe(false);
    expect(mockFindDuplicate).toHaveBeenCalledWith(expect.anything(), "<m1@example.com>");
    expect(mockEnsureAlias).toHaveBeenCalledWith(expect.anything(), "blog", "2026-07-31T01:00:00.000Z");
    expect(mockUploadAttachments).toHaveBeenCalled();
    expect(mockSaveInboundEmail).toHaveBeenCalledWith(
      expect.anything(),
      body.id,
      expect.objectContaining({ alias: "blog", messageId: "<m1@example.com>" }),
      [],
    );
  });

  it("無附件時不呼叫上傳", async () => {
    await POST(makeContext({ auth: "Bearer test-webhook-secret" }));
    expect(mockUploadAttachments).not.toHaveBeenCalled();
  });

  it("寫入失敗應回傳 500 讓上游重試", async () => {
    mockSaveInboundEmail.mockRejectedValue(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeContext({ auth: "Bearer test-webhook-secret" }));

    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });
});
