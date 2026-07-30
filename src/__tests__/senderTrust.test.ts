import { describe, it, expect } from "vitest";
import {
  assessSenderTrust,
  assessmentToRow,
  parseAuthenticationResults,
  parseReceivedSpf,
  resolveAuthDomain,
  resolveReputationDomain,
  senderDomain,
  TRUST_LEVEL_LABELS,
  type DomainReputation,
} from "../lib/senderTrust";

const GOOGLE_AR =
  "mx.google.com; dkim=pass header.i=@apple.com header.s=20230601; " +
  "spf=pass (google.com: domain of noreply@apple.com designates 17.0.0.1 as permitted sender) " +
  "smtp.mailfrom=noreply@apple.com; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=apple.com";

function reputation(overrides: Partial<DomainReputation> = {}): DomainReputation {
  return {
    domain: "apple.com",
    verdict: "clean",
    threatTypes: [],
    checkedAt: "2026-07-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseAuthenticationResults", () => {
  it("應解析出 SPF／DKIM／DMARC 結果與對應網域", () => {
    const parsed = parseAuthenticationResults(GOOGLE_AR);
    expect(parsed.spf).toBe("pass");
    expect(parsed.dkim).toBe("pass");
    expect(parsed.dmarc).toBe("pass");
    expect(parsed.spfDomain).toBe("apple.com");
    expect(parsed.dkimDomain).toBe("apple.com");
    expect(parsed.dmarcDomain).toBe("apple.com");
    expect(parsed.authservId).toBe("mx.google.com");
  });

  it("應忽略大小寫", () => {
    const parsed = parseAuthenticationResults("mx.google.com; SPF=Pass; DKIM=FAIL; DMARC=None");
    expect(parsed.spf).toBe("pass");
    expect(parsed.dkim).toBe("fail");
    expect(parsed.dmarc).toBe("none");
  });

  it("多筆標頭串接時應取第一次出現的值（最上方由自家 MX 加上）", () => {
    const raw = "mx.google.com; spf=pass; dkim=pass\nforwarder.example; spf=fail; dkim=fail";
    const parsed = parseAuthenticationResults(raw);
    expect(parsed.spf).toBe("pass");
    expect(parsed.dkim).toBe("pass");
  });

  it("應將未知結果值歸為 none", () => {
    expect(parseAuthenticationResults("mx; spf=weirdvalue").spf).toBe("none");
  });

  it("應保留 temperror 等合法結果值", () => {
    expect(parseAuthenticationResults("mx; dmarc=temperror").dmarc).toBe("temperror");
  });

  it("應對 null／空字串回傳全 none", () => {
    for (const input of [null, undefined, "   "]) {
      const parsed = parseAuthenticationResults(input);
      expect(parsed.spf).toBe("none");
      expect(parsed.dkim).toBe("none");
      expect(parsed.dmarc).toBe("none");
      expect(parsed.dkimDomain).toBeNull();
      expect(parsed.raw).toBe("");
    }
  });

  it("應從 header.i=@domain 取出網域", () => {
    expect(parseAuthenticationResults("mx; dkim=pass header.i=@mail.apple.com").dkimDomain)
      .toBe("mail.apple.com");
  });
});

describe("parseReceivedSpf", () => {
  it("應取出開頭的結果值", () => {
    expect(parseReceivedSpf("pass (google.com: domain of x@y designates ...)")).toBe("pass");
    expect(parseReceivedSpf("softfail")).toBe("softfail");
  });

  it("應對空值回傳 none", () => {
    expect(parseReceivedSpf(null)).toBe("none");
    expect(parseReceivedSpf("")).toBe("none");
  });
});

describe("senderDomain / resolveAuthDomain / resolveReputationDomain", () => {
  it("senderDomain 應取出 @ 之後的網域", () => {
    expect(senderDomain("news@insideapple.apple.com")).toBe("insideapple.apple.com");
    expect(senderDomain("nonsense")).toBeNull();
    expect(senderDomain(null)).toBeNull();
  });

  it("resolveAuthDomain 在無任何通過驗證時應回傳 null", () => {
    const parsed = parseAuthenticationResults("mx; spf=fail; dkim=fail; dmarc=fail");
    expect(resolveAuthDomain("attacker@apple.com", parsed)).toBeNull();
  });

  it("resolveAuthDomain 應優先取 DMARC 對齊網域", () => {
    const parsed = parseAuthenticationResults(GOOGLE_AR);
    expect(resolveAuthDomain("noreply@apple.com", parsed)).toBe("apple.com");
  });

  it("resolveReputationDomain 在未通過驗證時應退回寄件地址網域", () => {
    const parsed = parseAuthenticationResults("mx; spf=fail; dkim=fail; dmarc=fail");
    expect(resolveReputationDomain("attacker@evil.example", parsed)).toBe("evil.example");
  });
});

describe("assessSenderTrust — 等級判定", () => {
  it("DMARC 與 SPF 皆通過應為 trusted", () => {
    const result = assessSenderTrust({
      senderAddress: "noreply@apple.com",
      emailId: "m1",
      authenticationResults: GOOGLE_AR,
    });
    expect(result.level).toBe("trusted");
    expect(result.levelLabel).toBe(TRUST_LEVEL_LABELS.trusted);
  });

  it("僅 SPF 通過且非白名單網域應為 likely", () => {
    const result = assessSenderTrust({
      senderAddress: "info@example.com",
      emailId: "m2",
      authenticationResults: "mx; spf=pass smtp.mailfrom=info@example.com; dkim=none; dmarc=none",
    });
    expect(result.level).toBe("likely");
  });

  it("無任何驗證結果應為 unverified", () => {
    const result = assessSenderTrust({
      senderAddress: "info@example.com",
      emailId: "m3",
      authenticationResults: null,
    });
    expect(result.level).toBe("unverified");
    expect(result.evidence[0].detail).toContain("未附帶驗證標頭");
  });

  it("DMARC 失敗應為 suspicious 並蓋過 SPF 通過", () => {
    const result = assessSenderTrust({
      senderAddress: "info@example.com",
      emailId: "m4",
      authenticationResults: "mx; spf=pass smtp.mailfrom=info@example.com; dmarc=fail header.from=example.com",
    });
    expect(result.level).toBe("suspicious");
  });

  it("SPF 與 DKIM 同時失敗應為 suspicious", () => {
    const result = assessSenderTrust({
      senderAddress: "info@example.com",
      emailId: "m5",
      authenticationResults: "mx; spf=fail; dkim=fail; dmarc=none",
    });
    expect(result.level).toBe("suspicious");
  });

  it("Safe Browsing 命中威脅應為 dangerous，並蓋過全數通過的驗證", () => {
    const result = assessSenderTrust({
      senderAddress: "noreply@apple.com",
      emailId: "m6",
      authenticationResults: GOOGLE_AR,
      reputation: reputation({ verdict: "threat", threatTypes: ["SOCIAL_ENGINEERING"] }),
    });
    expect(result.level).toBe("dangerous");
    expect(result.reason).toContain("惡意網域");
  });

  it("Received-SPF 應在 Authentication-Results 缺少 spf 時作為後備", () => {
    const result = assessSenderTrust({
      senderAddress: "info@example.com",
      emailId: "m7",
      authenticationResults: "mx; dkim=none; dmarc=none",
      receivedSpf: "pass (google.com: ...)",
    });
    expect(result.spf).toBe("pass");
    expect(result.level).toBe("likely");
  });
});

describe("assessSenderTrust — 白名單只能升一級", () => {
  it("白名單命中應將 likely 升為 trusted", () => {
    const result = assessSenderTrust({
      senderAddress: "news@apple.com",
      emailId: "w1",
      authenticationResults: "mx; dkim=pass header.i=@apple.com; spf=none; dmarc=none",
    });
    expect(result.level).toBe("trusted");
    expect(result.evidence.some((e) => e.signal === "local_allowlist")).toBe(true);
  });

  it("偽造白名單網域（From apple.com 但 DMARC 失敗）仍應為 suspicious", () => {
    const result = assessSenderTrust({
      senderAddress: "security@apple.com",
      emailId: "w2",
      authenticationResults: "mx; spf=fail; dkim=fail; dmarc=fail header.from=apple.com",
    });
    expect(result.level).toBe("suspicious");
    expect(result.evidence.some((e) => e.signal === "local_allowlist")).toBe(false);
  });

  it("白名單不得作用於 Safe Browsing 判定的 dangerous", () => {
    const result = assessSenderTrust({
      senderAddress: "news@apple.com",
      emailId: "w3",
      authenticationResults: GOOGLE_AR,
      reputation: reputation({ verdict: "threat", threatTypes: ["MALWARE"] }),
    });
    expect(result.level).toBe("dangerous");
    expect(result.evidence.some((e) => e.signal === "local_allowlist")).toBe(false);
  });

  it("白名單比對對象應是對齊網域而非 From 顯示網域", () => {
    // From 是 apple.com，但唯一通過的驗證來自未列入白名單的 mailer.example
    const result = assessSenderTrust({
      senderAddress: "news@apple.com",
      emailId: "w4",
      authenticationResults: "mx; spf=pass smtp.mailfrom=bounce@mailer.example; dkim=none; dmarc=none",
    });
    expect(result.authDomain).toBe("mailer.example");
    expect(result.level).toBe("likely");
    expect(result.evidence.some((e) => e.signal === "local_allowlist")).toBe(false);
  });

  it("白名單不應把 unverified 直接升到 trusted", () => {
    const result = assessSenderTrust({
      senderAddress: "news@apple.com",
      emailId: "w5",
      authenticationResults: "mx; spf=neutral; dkim=none; dmarc=pass header.from=apple.com",
    });
    // dmarc=pass 但 spf/dkim 皆未 pass → base unverified，白名單升一級為 likely
    expect(result.level).toBe("likely");
  });
});

describe("assessSenderTrust — 信譽降級不影響等級", () => {
  it.each(["unknown", "error"] as const)("verdict 為 %s 時不應改變等級", (verdict) => {
    const result = assessSenderTrust({
      senderAddress: "info@example.com",
      emailId: "r1",
      authenticationResults: "mx; spf=pass smtp.mailfrom=info@example.com; dkim=none; dmarc=none",
      reputation: reputation({ domain: "example.com", verdict, errorMessage: "配額不足" }),
    });
    expect(result.level).toBe("likely");
    const evidence = result.evidence.find((e) => e.signal === "safe_browsing");
    expect(evidence?.detail).toContain("未採計");
  });
});

describe("assessSenderTrust — 證據來源", () => {
  it("應固定以 Gmail → 信譽 → 白名單 的順序輸出", () => {
    const result = assessSenderTrust({
      senderAddress: "news@apple.com",
      emailId: "e1",
      authenticationResults: "mx; dkim=pass header.i=@apple.com; spf=none; dmarc=none",
      reputation: reputation(),
    });
    expect(result.evidence.map((e) => e.signal)).toEqual([
      "gmail_auth",
      "safe_browsing",
      "local_allowlist",
    ]);
  });

  it("Gmail 證據應為內部連結並附帶標頭原文", () => {
    const result = assessSenderTrust({
      senderAddress: "noreply@apple.com",
      emailId: "e2",
      authenticationResults: GOOGLE_AR,
    });
    const gmail = result.evidence[0];
    expect(gmail.href).toBe("/emails/e2");
    expect(gmail.external).toBe(false);
    expect(gmail.raw).toBe(GOOGLE_AR);
  });

  it("未查詢信譽時不應列出 Safe Browsing 證據", () => {
    const result = assessSenderTrust({
      senderAddress: "noreply@apple.com",
      emailId: "e3",
      authenticationResults: GOOGLE_AR,
    });
    expect(result.evidence.some((e) => e.signal === "safe_browsing")).toBe(false);
  });

  it("Safe Browsing 證據應連向 Transparency Report 且為外部連結", () => {
    const result = assessSenderTrust({
      senderAddress: "noreply@apple.com",
      emailId: "e4",
      authenticationResults: GOOGLE_AR,
      reputation: reputation(),
    });
    const sb = result.evidence.find((e) => e.signal === "safe_browsing");
    expect(sb?.href).toBe(
      "https://transparencyreport.google.com/safe-browsing/search?url=apple.com",
    );
    expect(sb?.external).toBe(true);
  });
});

describe("assessmentToRow", () => {
  it("應輸出 first_sender_events 的 update payload", () => {
    const assessment = assessSenderTrust({
      senderAddress: "noreply@apple.com",
      emailId: "row1",
      authenticationResults: GOOGLE_AR,
    });
    const now = new Date("2026-07-31T12:00:00.000Z");
    const row = assessmentToRow(assessment, now);

    expect(row).toMatchObject({
      trust_level: "trusted",
      spf_result: "pass",
      dkim_result: "pass",
      dmarc_result: "pass",
      auth_domain: "apple.com",
      trust_evaluated_at: "2026-07-31T12:00:00.000Z",
      updated_at: "2026-07-31T12:00:00.000Z",
    });
    expect(row.trust_evidence).toBe(assessment.evidence);
  });
});
