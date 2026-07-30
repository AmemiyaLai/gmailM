import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockListKeywords, mockAddKeyword, mockSetKeywordEnabled, mockDeleteKeyword, mockIsCleanupField, mockIsCleanupAction } = vi.hoisted(() => ({
  mockListKeywords: vi.fn(),
  mockAddKeyword: vi.fn(),
  mockSetKeywordEnabled: vi.fn(),
  mockDeleteKeyword: vi.fn(),
  mockIsCleanupField: vi.fn(),
  mockIsCleanupAction: vi.fn(),
}));

vi.mock("../../../lib/cleanupKeywords", () => ({
  listKeywords: mockListKeywords,
  addKeyword: mockAddKeyword,
  setKeywordEnabled: mockSetKeywordEnabled,
  deleteKeyword: mockDeleteKeyword,
  isCleanupField: mockIsCleanupField,
  isCleanupAction: mockIsCleanupAction,
}));

import { GET, POST, PATCH, DELETE } from "../../../pages/api/cleanup/keywords";

describe("GET /api/cleanup/keywords", () => {
  beforeEach(() => vi.clearAllMocks());

  it("應回傳關鍵字列表", async () => {
    mockListKeywords.mockResolvedValue([
      { id: "1", keyword: "優惠", field: "any", enabled: true },
    ]);
    const res = await GET({} as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keywords).toHaveLength(1);
    expect(body.keywords[0].keyword).toBe("優惠");
  });
});

describe("POST /api/cleanup/keywords", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCleanupField.mockReturnValue(true);
    mockIsCleanupAction.mockReturnValue(true);
  });

  it("新增關鍵字成功應回傳 201", async () => {
    mockAddKeyword.mockResolvedValue({ id: "new", keyword: "廣告", field: "subject", enabled: true });
    const request = new Request("http://localhost/api/cleanup/keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "廣告", field: "subject" }),
    });
    const res = await POST({ request } as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.keyword.keyword).toBe("廣告");
  });

  it("無效 JSON body 應回傳 400", async () => {
    const request = new Request("http://localhost/api/cleanup/keywords", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "invalid",
    });
    const res = await POST({ request } as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
  });

  it("關鍵字為空時應回傳 400", async () => {
    const request = new Request("http://localhost/api/cleanup/keywords", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "", field: "any" }),
    });
    const res = await POST({ request } as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("關鍵字不可為空");
  });

  it("關鍵字非字串時應回傳 400", async () => {
    const request = new Request("http://localhost/api/cleanup/keywords", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: 123, field: "any" }),
    });
    const res = await POST({ request } as never);
    expect(res.status).toBe(400);
  });

  it("無效欄位時應回傳 400", async () => {
    mockIsCleanupField.mockReturnValue(false);
    const request = new Request("http://localhost/api/cleanup/keywords", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "test", field: "invalid" }),
    });
    const res = await POST({ request } as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("無效的比對欄位");
  });

  it("addKeyword 拋錯時應回傳 400", async () => {
    mockAddKeyword.mockRejectedValue(new Error("這個關鍵字已經存在"));
    const request = new Request("http://localhost/api/cleanup/keywords", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "test", field: "any" }),
    });
    const res = await POST({ request } as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("這個關鍵字已經存在");
  });
});

describe("PATCH /api/cleanup/keywords", () => {
  beforeEach(() => vi.clearAllMocks());

  it("啟用關鍵字成功應回傳 ok", async () => {
    mockSetKeywordEnabled.mockResolvedValue(undefined);
    const request = new Request("http://localhost/api/cleanup/keywords", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "1", enabled: true }),
    });
    const res = await PATCH({ request } as never);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
    expect(mockSetKeywordEnabled).toHaveBeenCalledWith("1", true);
  });

  it("缺少 id 或 enabled 時應回傳 400", async () => {
    const request = new Request("http://localhost/api/cleanup/keywords", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "1" }),
    });
    const res = await PATCH({ request } as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("缺少 id 或 enabled");
  });

  it("無效 JSON body 應回傳 400", async () => {
    const request = new Request("http://localhost/api/cleanup/keywords", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: "invalid",
    });
    const res = await PATCH({ request } as never);
    expect(res.status).toBe(400);
  });

  it("setKeywordEnabled 失敗時應回傳 500", async () => {
    mockSetKeywordEnabled.mockRejectedValue(new Error("更新失敗"));
    const request = new Request("http://localhost/api/cleanup/keywords", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "1", enabled: false }),
    });
    const res = await PATCH({ request } as never);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("更新失敗");
  });
});

describe("DELETE /api/cleanup/keywords", () => {
  beforeEach(() => vi.clearAllMocks());

  it("刪除關鍵字成功應回傳 ok", async () => {
    mockDeleteKeyword.mockResolvedValue(undefined);
    const request = new Request("http://localhost/api/cleanup/keywords", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "1" }),
    });
    const res = await DELETE({ request } as never);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
    expect(mockDeleteKeyword).toHaveBeenCalledWith("1");
  });

  it("缺少 id 時應回傳 400", async () => {
    const request = new Request("http://localhost/api/cleanup/keywords", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await DELETE({ request } as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("缺少 id");
  });

  it("id 為空字串時應回傳 400", async () => {
    const request = new Request("http://localhost/api/cleanup/keywords", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "" }),
    });
    const res = await DELETE({ request } as never);
    expect(res.status).toBe(400);
  });

  it("無效 JSON body 應回傳 400", async () => {
    const request = new Request("http://localhost/api/cleanup/keywords", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: "invalid",
    });
    const res = await DELETE({ request } as never);
    expect(res.status).toBe(400);
  });

  it("deleteKeyword 失敗時應回傳 500", async () => {
    mockDeleteKeyword.mockRejectedValue(new Error("刪除失敗"));
    const request = new Request("http://localhost/api/cleanup/keywords", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "1" }),
    });
    const res = await DELETE({ request } as never);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("刪除失敗");
  });
});
