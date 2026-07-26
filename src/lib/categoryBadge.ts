export interface CategoryBadge {
  label: string;
  bg: string;
  color: string;
}

const badges: Record<string, CategoryBadge> = {
  devlog: { label: "開發日誌", bg: "var(--color-info)", color: "white" },
  newsletter: { label: "電子報", bg: "var(--color-primary-muted)", color: "var(--color-primary-hover)" },
  system: { label: "系統通知", bg: "var(--color-warning)", color: "white" },
  banking: { label: "銀行 / 金融", bg: "var(--color-success)", color: "white" },
  ecommerce: { label: "電子商務", bg: "var(--color-warning)", color: "white" },
  securities: { label: "證券 / 投資", bg: "var(--color-error)", color: "white" },
  uncategorized: { label: "未分類", bg: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)" },
};

export function categoryBadge(category?: string | null): CategoryBadge | null {
  if (!category) return null;
  return badges[category] ?? null;
}
