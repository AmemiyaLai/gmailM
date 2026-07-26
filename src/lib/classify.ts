export interface ClassificationRule {
  category: string;
  senderIncludes?: string[];
  subjectMatches?: RegExp;
}

export const rules: ClassificationRule[] = [
  { category: "devlog", senderIncludes: ["github.com", "gitlab.com"] },
  { category: "newsletter", subjectMatches: /電子報|newsletter|digest/i },
  { category: "system", senderIncludes: ["no-reply@", "noreply@", "notifications@"] },
];

export const categories = [...rules.map((rule) => rule.category), "uncategorized"];

export function classifyEmail(email: { sender: string; subject: string }): string {
  const sender = email.sender.toLowerCase();
  const subject = email.subject ?? "";

  for (const rule of rules) {
    if (rule.senderIncludes?.some((needle) => sender.includes(needle))) {
      return rule.category;
    }
    if (rule.subjectMatches?.test(subject)) {
      return rule.category;
    }
  }

  return "uncategorized";
}
