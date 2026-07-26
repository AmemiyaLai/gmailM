export interface CategoryBadge {
  label: string;
  bg: string;
  color: string;
}

const badges: Record<string, CategoryBadge> = {
  devlog: { label: "開發日誌", bg: "var(--color-info)", color: "white" },
  newsletter: { label: "電子報", bg: "var(--color-primary-muted)", color: "var(--color-primary-hover)" },
  system: { label: "系統通知", bg: "var(--color-warning)", color: "white" },
};

export function categoryBadge(category?: string | null): CategoryBadge | null {
  if (!category) return null;
  return badges[category] ?? null;
}
