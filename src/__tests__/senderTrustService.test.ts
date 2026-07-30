import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetMessageAuthHeaders = vi.fn();
const mockGetDomainReputations = vi.fn();

vi.mock("../lib/gmail", () => ({
  getMessageAuthHeaders: (...args: unknown[]) => mockGetMessageAuthHeaders(...args),
}));
vi.mock("../lib/domainReputation", () => ({
  getDomainReputations: (...args: unknown[]) => mockGetDomainReputations(...args),
}));

import { backfillSenderTrust, evaluateAndStoreTrust } from "../lib/senderTrustService";

const PASS_AR =
  "mx.google.com; dkim=pass header.i=@apple.com; spf=pass smtp.mailfrom=news@apple.com; " +
  "dmarc=pass header.from=apple.com";

interface QueryOps {
  table: string;
  select: string | null;
  selectOptions: Record<string, unknown> | null;
  isFilter: [string, unknown] | null;
  ordered: boolean;
  limit: number | null;
  inValues: unknown[] | null;
  update: Record<string, unknown> | null;
  eq: [string, unknown] | null;
}

interface SupabaseState {
  events: unknown[];
  emails: unknown[];
  pendingCount: number;
  updateError: unknown;
  ops: QueryOps[];
}

function makeSupabase(overrides: Partial<SupabaseState> = {}) {
  const state: SupabaseState = {
    events: [],
    emails: [],
    pendingCount: 0,
    updateError: null,
    ops: [],
    ...overrides,
  };

  function makeQuery(table: string) {
    const ops: QueryOps = {
      table,
      select: null,
      selectOptions: null,
      isFilter: null,
      ordered: false,
      limit: null,
      inValues: null,
      update: null,
      eq: null,
    };

    const query = {
      select(cols: string, options?: Record<string, unknown>) {
        ops.select = cols;
        ops.selectOptions = options ?? null;
        return query;
      },
      is(column: string, value: unknown) {
        ops.isFilter = [column, value];
        return query;
      },
      order() {
        ops.ordered = true;
        return query;
      },
      limit(value: number) {
        ops.limit = value;
        return query;
      },
      in(_column: string, values: unknown[]) {
        ops.inValues = values;
        return query;
      },
      update(payload: Record<string, unknown>) {
        ops.update = payload;
        return query;
      },
      eq(column: string, value: unknown) {
        ops.eq = [column, value];
        return query;
      },
      then(resolve: (value: unknown) => unknown) {
        state.ops.push(ops);
        if (ops.update) return resolve({ error: state.updateError });
        if (ops.selectOptions?.head) return resolve({ data: null, count: state.pendingCount, error: null });
        if (table === "emails") return resolve({ data: state.emails, error: null });
        return resolve({ data: state.events, error: null });
      },
    };
    return query;
  }

  return { supabase: { from: vi.fn((table: string) => makeQuery(table)) }, state };
}

function opsFor(state: SupabaseState, predicate: (op: QueryOps) => boolean) {
  return state.ops.filter(predicate);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDomainReputations.mockResolvedValue(new Map());
});

describe("evaluateAndStoreTrust", () => {
  it("應寫入判定結果到 first_sender_events", async () => {
    const { supabase, state } = makeSupabase();

    const assessment = await evaluateAndStoreTrust(supabase as never, {
      senderAddress: "news@apple.com",
      emailId: "m1",
      authenticationResults: PASS_AR,
      receivedSpf: null,
    });

    expect(assessment.level).toBe("trusted");
    const [update] = opsFor(state, (op) => !!op.update);
    expect(update.table).toBe("first_sender_events");
    expect(update.eq).toEqual(["sender_address", "news@apple.com"]);
    expect(update.update).toMatchObject({
      trust_level: "trusted",
      spf_result: "pass",
      dkim_result: "pass",
      dmarc_result: "pass",
      auth_domain: "apple.com",
    });
  });

  it("應以對齊網域查詢信譽", async () => {
    const { supabase } = makeSupabase();

    await evaluateAndStoreTrust(supabase as never, {
      senderAddress: "news@apple.com",
      emailId: "m1",
      authenticationResults: PASS_AR,
      receivedSpf: null,
    });

    expect(mockGetDomainReputations).toHaveBeenCalledWith(supabase, ["apple.com"]);
  });

  it("信譽查詢失敗時仍應完成判定", async () => {
    mockGetDomainReputations.mockRejectedValue(new Error("配額不足"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = makeSupabase();

    const assessment = await evaluateAndStoreTrust(supabase as never, {
      senderAddress: "news@apple.com",
      emailId: "m1",
      authenticationResults: PASS_AR,
      receivedSpf: null,
    });

    expect(assessment.level).toBe("trusted");
    errorSpy.mockRestore();
  });

  it("寫入失敗時應拋出錯誤", async () => {
    const { supabase } = makeSupabase({ updateError: { message: "boom" } });

    await expect(
      evaluateAndStoreTrust(supabase as never, {
        senderAddress: "news@apple.com",
        emailId: "m1",
        authenticationResults: PASS_AR,
        receivedSpf: null,
      }),
    ).rejects.toMatchObject({ message: "boom" });
  });
});

describe("backfillSenderTrust", () => {
  it("應只取尚未評估（trust_level 為 null）的列", async () => {
    const { supabase, state } = makeSupabase({ events: [] });

    await backfillSenderTrust(supabase as never, { delayMs: 0 });

    const listOp = state.ops.find((op) => op.table === "first_sender_events" && op.ordered);
    expect(listOp?.isFilter).toEqual(["trust_level", null]);
  });

  it("應將 limit 夾在 1–200 之間", async () => {
    const { supabase, state } = makeSupabase();

    await backfillSenderTrust(supabase as never, { limit: 999, delayMs: 0 });
    expect(state.ops.find((op) => op.ordered)?.limit).toBe(200);

    const second = makeSupabase();
    await backfillSenderTrust(second.supabase as never, { limit: 0, delayMs: 0 });
    expect(second.state.ops.find((op) => op.ordered)?.limit).toBe(1);
  });

  it("標頭已落庫時不應呼叫 Gmail", async () => {
    const { supabase, state } = makeSupabase({
      events: [{ sender_address: "news@apple.com", first_email_id: "e1" }],
      emails: [{ id: "e1", authentication_results: PASS_AR, received_spf: null }],
    });

    const result = await backfillSenderTrust(supabase as never, { delayMs: 0 });

    expect(mockGetMessageAuthHeaders).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 1, fetched: 0, assessed: 1, failed: 0 });
    const update = state.ops.find((op) => op.table === "first_sender_events" && op.update);
    expect(update?.update).toMatchObject({ trust_level: "trusted" });
  });

  it("標頭缺漏時應向 Gmail 補抓並回寫 emails", async () => {
    mockGetMessageAuthHeaders.mockResolvedValue({
      id: "e1",
      from: "Apple <news@apple.com>",
      authenticationResults: PASS_AR,
      receivedSpf: "pass",
    });
    const { supabase, state } = makeSupabase({
      events: [{ sender_address: "news@apple.com", first_email_id: "e1" }],
      emails: [{ id: "e1", authentication_results: null, received_spf: null }],
    });

    const result = await backfillSenderTrust(supabase as never, { delayMs: 0 });

    expect(mockGetMessageAuthHeaders).toHaveBeenCalledWith("e1");
    expect(result).toMatchObject({ fetched: 1, assessed: 1, failed: 0 });
    const emailUpdate = state.ops.find((op) => op.table === "emails" && op.update);
    expect(emailUpdate?.update).toEqual({
      authentication_results: PASS_AR,
      received_spf: "pass",
    });
  });

  it("單筆 Gmail 失敗應計入 failed 且不中斷其餘列", async () => {
    mockGetMessageAuthHeaders
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({
        id: "e2",
        from: "b@example.com",
        authenticationResults: "mx; spf=pass smtp.mailfrom=b@example.com",
        receivedSpf: "",
      });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = makeSupabase({
      events: [
        { sender_address: "a@example.com", first_email_id: "e1" },
        { sender_address: "b@example.com", first_email_id: "e2" },
      ],
      emails: [],
    });

    const result = await backfillSenderTrust(supabase as never, { delayMs: 0 });

    expect(result).toMatchObject({ scanned: 2, fetched: 1, assessed: 1, failed: 1 });
    errorSpy.mockRestore();
  });

  it("force 模式不應呼叫 Gmail，也不應加上 trust_level 篩選", async () => {
    const { supabase, state } = makeSupabase({
      events: [{ sender_address: "news@apple.com", first_email_id: "e1" }],
      emails: [{ id: "e1", authentication_results: null, received_spf: null }],
    });

    const result = await backfillSenderTrust(supabase as never, { force: true, delayMs: 0 });

    expect(mockGetMessageAuthHeaders).not.toHaveBeenCalled();
    const listOp = state.ops.find((op) => op.ordered);
    expect(listOp?.isFilter).toBeNull();
    expect(result).toMatchObject({ fetched: 0, assessed: 1 });
  });

  it("寫入判定結果失敗應計入 failed", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = makeSupabase({
      events: [{ sender_address: "news@apple.com", first_email_id: "e1" }],
      emails: [{ id: "e1", authentication_results: PASS_AR, received_spf: null }],
      updateError: { message: "boom" },
    });

    const result = await backfillSenderTrust(supabase as never, { delayMs: 0 });
    expect(result).toMatchObject({ assessed: 0, failed: 1 });
    errorSpy.mockRestore();
  });

  it("應回傳仍未評估的剩餘筆數", async () => {
    const { supabase } = makeSupabase({ events: [], pendingCount: 42 });

    const result = await backfillSenderTrust(supabase as never, { delayMs: 0 });
    expect(result.remaining).toBe(42);
  });

  it("應以去重後的網域一次查詢信譽", async () => {
    const { supabase } = makeSupabase({
      events: [
        { sender_address: "a@apple.com", first_email_id: "e1" },
        { sender_address: "b@apple.com", first_email_id: "e2" },
      ],
      emails: [
        { id: "e1", authentication_results: PASS_AR, received_spf: null },
        { id: "e2", authentication_results: PASS_AR, received_spf: null },
      ],
    });

    await backfillSenderTrust(supabase as never, { delayMs: 0 });

    expect(mockGetDomainReputations).toHaveBeenCalledTimes(1);
    expect(mockGetDomainReputations).toHaveBeenCalledWith(supabase, ["apple.com"]);
  });
});
