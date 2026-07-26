/**
 * 寄信者群組（Sender Group）靜態定義
 *
 * 這與資料庫的 category 欄位是不同概念：
 *   - category: AI 分類的郵件主題標籤（存在 emails 資料表）
 *   - SenderGroup: 以發信者網域 pattern 為主的前端靜態群組
 *
 * 用途：首頁儀錶板右半部的 6 張群組卡片
 */

export interface SenderGroup {
  id: string;
  label: string;
  icon: string;
  colorVar: string;
  /** 小寫字串 pattern，只要 sender.toLowerCase() 包含任一 pattern 即匹配 */
  patterns: string[];
}

export const SENDER_GROUPS: SenderGroup[] = [
  {
    id: "banking",
    label: "銀行 / 金融",
    icon: "🏦",
    colorVar: "--color-success",
    patterns: [
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
    id: "devtools",
    label: "程式碼 / 開發",
    icon: "💻",
    colorVar: "--color-info",
    patterns: [
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
  {
    id: "ecommerce",
    label: "電子商務",
    icon: "🛍️",
    colorVar: "--color-warning",
    patterns: [
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
    id: "newsletter",
    label: "電子報",
    icon: "📰",
    colorVar: "--color-primary",
    patterns: [
      "newsletter",
      "digest",
      "substack",
      "medium.com",
      "revue",
      "mailchimp",
      "constantcontact",
      "sendgrid",
      "campaign",
      "weekly",
      "daily",
      "morning brew",
      "the hustle",
    ],
  },
  {
    id: "securities",
    label: "證券 / 投資",
    icon: "📈",
    colorVar: "--color-error",
    patterns: [
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
  {
    id: "others",
    label: "其他通知",
    icon: "📦",
    colorVar: "--color-text-tertiary",
    patterns: [],   // 兜底群組，不匹配任何 pattern，在程式中特殊處理
  },
];

/**
 * 依 sender 字串判斷所屬群組 id。
 * 按照 SENDER_GROUPS 順序優先匹配，最後返回 "others"。
 */
export function getSenderGroupId(sender: string): string {
  const lower = sender.toLowerCase();
  for (const group of SENDER_GROUPS) {
    if (group.id === "others") continue;
    if (group.patterns.some((p) => lower.includes(p))) {
      return group.id;
    }
  }
  return "others";
}

/**
 * 依 groupId 查找群組定義，找不到時返回 null。
 */
export function findSenderGroup(groupId: string): SenderGroup | null {
  return SENDER_GROUPS.find((g) => g.id === groupId) ?? null;
}
