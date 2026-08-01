import { extractSenderName } from "./senderUtils";

export interface EmailWithSenderAndDate {
  sender: string;
  received_at: string;
}

export interface SenderJumpEmail {
  sender: string;
  is_read: boolean;
  is_important?: boolean | null;
}

export interface SenderJumpItem {
  id: string;
  sender: string;
  label: string;
  count: number;
  unreadCount: number;
  importantCount: number;
}

export interface SenderEmailGroup<T> {
  sender: string;
  emails: T[];
}

function receivedAtTime(email: EmailWithSenderAndDate) {
  const time = Date.parse(email.received_at);
  return Number.isNaN(time) ? 0 : time;
}

export function partitionEmailsBySender<T extends EmailWithSenderAndDate>(emails: T[]) {
  const groupMap = new Map<string, T[]>();

  for (const email of emails) {
    const senderEmails = groupMap.get(email.sender);
    if (senderEmails) {
      senderEmails.push(email);
    } else {
      groupMap.set(email.sender, [email]);
    }
  }

  const groups: SenderEmailGroup<T>[] = [...groupMap.entries()].map(([sender, senderEmails]) => ({
    sender,
    emails: [...senderEmails].sort((a, b) => receivedAtTime(b) - receivedAtTime(a)),
  }));

  groups.sort((a, b) => receivedAtTime(b.emails[0]) - receivedAtTime(a.emails[0]));

  return {
    collapsibleGroups: groups.filter((group) => group.emails.length > 1),
    standaloneEmails: groups
      .filter((group) => group.emails.length === 1)
      .map((group) => group.emails[0])
      .sort((a, b) => receivedAtTime(b) - receivedAtTime(a)),
  };
}

/**
 * 依畫面中的首次出現順序建立寄件者快速導航。
 * 僅保留重複寄信、含未讀信或含重要信的優先寄件者。
 */
export function buildSenderJumpItems<T extends SenderJumpEmail>(
  emails: T[],
  idPrefix = "sender",
): SenderJumpItem[] {
  const senderMap = new Map<string, Omit<SenderJumpItem, "id">>();

  for (const email of emails) {
    const existing = senderMap.get(email.sender);
    if (existing) {
      existing.count += 1;
      if (!email.is_read) existing.unreadCount += 1;
      if (email.is_important) existing.importantCount += 1;
      continue;
    }

    senderMap.set(email.sender, {
      sender: email.sender,
      label: extractSenderName(email.sender),
      count: 1,
      unreadCount: email.is_read ? 0 : 1,
      importantCount: email.is_important ? 1 : 0,
    });
  }

  return [...senderMap.values()]
    .filter((item) => item.count > 1 || item.unreadCount > 0 || item.importantCount > 0)
    .map((item, index) => ({
      id: `${idPrefix}-${index + 1}`,
      ...item,
    }));
}
