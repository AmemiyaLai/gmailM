import { describe, expect, it } from "vitest";
import { buildSenderJumpItems, partitionEmailsBySender } from "../lib/emailDisplayGroups";

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

describe("buildSenderJumpItems()", () => {
  const jumpEmail = (
    sender: string,
    is_read: boolean,
    is_important = false,
  ) => ({ sender, is_read, is_important });

  it("應只保留重複、未讀或重要寄件者", () => {
    const result = buildSenderJumpItems([
      jumpEmail("normal@example.com", true),
      jumpEmail("repeat@example.com", true),
      jumpEmail("unread@example.com", false),
      jumpEmail("important@example.com", true, true),
      jumpEmail("repeat@example.com", true),
    ]);

    expect(result.map(({ sender }) => sender)).toEqual([
      "repeat@example.com",
      "unread@example.com",
      "important@example.com",
    ]);
  });

  it("應依首次出現順序彙總郵件、未讀與重要數量", () => {
    const result = buildSenderJumpItems([
      jumpEmail('"Alice" <alice@example.com>', false, true),
      jumpEmail("bob@example.com", false),
      jumpEmail('"Alice" <alice@example.com>', true),
      jumpEmail("bob@example.com", false, true),
    ], "quick");

    expect(result).toEqual([
      {
        id: "quick-1",
        sender: '"Alice" <alice@example.com>',
        label: "Alice",
        count: 2,
        unreadCount: 1,
        importantCount: 1,
      },
      {
        id: "quick-2",
        sender: "bob@example.com",
        label: "bob@example.com",
        count: 2,
        unreadCount: 2,
        importantCount: 1,
      },
    ]);
  });

  it("空清單或只有單封普通已讀郵件時應回傳空導航", () => {
    expect(buildSenderJumpItems([])).toEqual([]);
    expect(buildSenderJumpItems([jumpEmail("normal@example.com", true)])).toEqual([]);
  });
});
