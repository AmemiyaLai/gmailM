export interface EmailWithSenderAndDate {
  sender: string;
  received_at: string;
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
