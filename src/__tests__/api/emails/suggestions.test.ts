import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/supabase", () => ({
  getSupabase: vi.fn(),
}));

import { getSupabase } from "../../../lib/supabase";
import { GET } from "../../../pages/api/emails/suggestions";

function setupSupabase(
  ...results: Array<{ data: unknown[] | null; error: unknown }>
) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  };
  for (const result of results) {
    chain.limit.mockResolvedValueOnce(result);
  }
  const from = vi.fn(() => chain);
  vi.mocked(getSupabase).mockReturnValue({ from } as never);
  return { chain, from };
}

describe("GET /api/emails/suggestions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("空白查詢應直接回傳空結果", async () => {
    const res = await GET({
      url: new URL("http://localhost/api/emails/suggestions?q=%20%20"),
    } as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ emails: [] });
    expect(getSupabase).not.toHaveBeenCalled();
  });

  it("中文短詞應以 search_text 子字串搜尋並限制最新六筆", async () => {
    const emails = [{ id: "m1", sender: "蝦皮購物", subject: "您的款項已確認", snippet: "" }];
    const { chain } = setupSupabase({ data: emails, error: null });

    const res = await GET({
      url: new URL("http://localhost/api/emails/suggestions?q=%E8%9D%A6%E7%9A%AE"),
    } as never);

    expect(chain.ilike).toHaveBeenCalledWith("search_text", "%蝦皮%");
    expect(chain.order).toHaveBeenCalledWith("received_at", { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(6);
    await expect(res.json()).resolves.toEqual({ emails });
  });

  it("多關鍵字應各自加入 ILIKE 條件形成 AND 搜尋", async () => {
    const { chain } = setupSupabase({ data: [], error: null });

    await GET({
      url: new URL("http://localhost/api/emails/suggestions?q=%E8%9D%A6%E7%9A%AE+%E6%92%A5%E6%AC%BE"),
    } as never);

    expect(chain.ilike.mock.calls).toEqual([
      ["search_text", "%蝦皮%"],
      ["search_text", "%撥款%"],
    ]);
  });

  it("特殊字元應按字面轉義", async () => {
    const { chain } = setupSupabase({ data: [], error: null });

    await GET({
      url: new URL("http://localhost/api/emails/suggestions?q=100%25_%5C"),
    } as never);

    expect(chain.ilike).toHaveBeenCalledWith("search_text", String.raw`%100\%\_\\%`);
  });

  it("資料庫查詢失敗時應回傳 500", async () => {
    setupSupabase({ data: null, error: { message: "db error" } });

    const res = await GET({
      url: new URL("http://localhost/api/emails/suggestions?q=shopee"),
    } as never);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "搜尋候選郵件失敗" });
  });

  it("search_text migration 未套用時應退回既有欄位搜尋", async () => {
    const emails = [{ id: "m1", sender: "蝦皮購物", subject: "撥款", snippet: "" }];
    const { chain, from } = setupSupabase(
      {
        data: null,
        error: {
          code: "42703",
          message: "column emails.search_text does not exist",
        },
      },
      { data: emails, error: null },
    );

    const res = await GET({
      url: new URL("http://localhost/api/emails/suggestions?q=%E8%9D%A6%E7%9A%AE+%E6%92%A5%E6%AC%BE"),
    } as never);

    expect(from).toHaveBeenCalledTimes(2);
    expect(chain.or.mock.calls).toEqual([
      ['sender.ilike."%蝦皮%",subject.ilike."%蝦皮%",snippet.ilike."%蝦皮%"'],
      ['sender.ilike."%撥款%",subject.ilike."%撥款%",snippet.ilike."%撥款%"'],
    ]);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ emails });
  });
});
