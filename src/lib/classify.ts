export interface ClassificationRule {
  category: string;
  senderIncludes?: string[];
  subjectMatches?: RegExp;
}

export const rules: ClassificationRule[] = [
  {
    category: "devlog",
    senderIncludes: [
      "github.com",
      "gitlab.com",
      "bitbucket",
      "stackoverflow",
      "jetbrains",
      "vercel",
      "netlify",
      "heroku",
      "render.com",
      "railway.app",
      "supabase",
      "firebase",
      "aws",
      "azure",
      "google cloud",
      "npm ",
      "docker",
      "jira",
      "confluence",
      "linear.app",
    ],
  },
  { category: "newsletter", subjectMatches: /電子報|newsletter|digest/i },
  { category: "system", senderIncludes: ["no-reply@", "noreply@", "notifications@"] },
  {
    category: "banking",
    senderIncludes: [
      "esun",
      "ctbc",
      "fubon",
      "sinopac",
      "taishin",
      "cathay",
      "yuanta",
      "mega",
      "land bank",
      "taipei bank",
      "hua nan",
      "chang hwa",
      "bank",
      "financial",
      "bancorp",
      "paypal",
      "stripe",
    ],
  },
  {
    category: "ecommerce",
    senderIncludes: [
      "shopee",
      "momo",
      "pchome",
      "amazon",
      "shopify",
      "lazada",
      "rakuten",
      "yahoo!",
      "etsy",
      "ebay",
      "udn",
      "iherb",
      "aliexpress",
    ],
  },
  {
    category: "securities",
    senderIncludes: [
      "capital",
      "凱基",
      "群益",
      "富邦證",
      "元大",
      "yuanta sec",
      "kgi",
      "永豐金",
      "第一金",
      "兆豐",
      "國泰證",
      "臺銀",
      "合庫",
      "securities",
      "brokerage",
      "invest",
      "stock",
    ],
  },
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
