import { describe, expect, it } from "vitest";
import { partitionEmailsBySender } from "../lib/emailDisplayGroups";

const email = (id: string, sender: string, received_at: string) => ({
  id,
  sender,
  received_at,
});

describe("partitionEmailsBySender()", () => {
  it("應將可折疊寄件者群組與單封郵件分開", () => {
    const result = partitionEmailsBySender([
      email("single-new", "single-new@example.com", "2026-07-31T10:00:00Z"),
      email("group-new", "group@example.com", "2026-07-31T09:00:00Z"),
      email("single-old", "single-old@example.com", "2026-07-31T08:00:00Z"),
      email("group-old", "group@example.com", "2026-07-31T07:00:00Z"),
    ]);

    expect(result.collapsibleGroups).toHaveLength(1);
    expect(result.collapsibleGroups[0].sender).toBe("group@example.com");
    expect(result.collapsibleGroups[0].emails.map(({ id }) => id)).toEqual([
      "group-new",
      "group-old",
    ]);
    expect(result.standaloneEmails.map(({ id }) => id)).toEqual([
      "single-new",
      "single-old",
    ]);
  });

  it("應依各群組最新郵件時間由新到舊排列", () => {
    const result = partitionEmailsBySender([
      email("older-new", "older@example.com", "2026-07-30T09:00:00Z"),
      email("newer-old", "newer@example.com", "2026-07-31T08:00:00Z"),
      email("older-old", "older@example.com", "2026-07-30T08:00:00Z"),
      email("newer-new", "newer@example.com", "2026-07-31T09:00:00Z"),
    ]);

    expect(result.collapsibleGroups.map(({ sender }) => sender)).toEqual([
      "newer@example.com",
      "older@example.com",
    ]);
  });
});
