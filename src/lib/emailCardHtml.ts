import { categoryBadge } from "./categoryBadge";

export interface NewEmailData {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  received_at: string;
  category?: string | null;
  is_important?: boolean;
}

export function renderEmailCardHtml(data: NewEmailData): string {
  const badge = categoryBadge(data.category ?? null);

  return `
    <div style="display:flex; justify-content:space-between; align-items:start; gap:var(--space-4);">
      <div style="min-width:0; flex:1;">
        <div style="display:flex; align-items:center; gap:var(--space-2); margin-bottom:var(--space-1);">
          <span class="unread-dot" style="width:8px; height:8px; border-radius:50%; background:var(--color-primary); flex-shrink:0;"></span>
          <strong style="color:var(--color-text); font-size:var(--font-size-sm); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${data.sender}
          </strong>
          ${badge ? `<span class="badge" style="background:${badge.bg}; color:${badge.color}; flex-shrink:0;">${badge.label}</span>` : ""}
          ${data.is_important ? `<span title="重要郵件" style="flex-shrink:0;">⭐</span>` : ""}
        </div>
        <div style="font-size:var(--font-size-sm); font-weight:var(--font-weight-medium); margin-bottom:var(--space-1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${data.subject || "(無主旨)"}
        </div>
        <div style="font-size:var(--font-size-xs); color:var(--color-text-tertiary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${data.snippet}
        </div>
      </div>
      <time
        datetime="${data.received_at}"
        style="font-size:var(--font-size-xs); color:var(--color-text-tertiary); white-space:nowrap; flex-shrink:0;"
      >
        ${new Date(data.received_at).toLocaleDateString("zh-TW", { month: "short", day: "numeric" })}
      </time>
    </div>
  `;
}

export function buildEmailCardElement(data: NewEmailData): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = `/emails/${encodeURIComponent(data.id)}`;
  link.className = "card email-card";
  link.dataset.id = data.id;
  link.dataset.read = "false";
  link.style.display = "block";
  link.style.textDecoration = "none";
  link.style.color = "inherit";
  if (data.is_important) {
    link.style.borderLeft = "3px solid var(--color-error)";
  }
  link.innerHTML = renderEmailCardHtml(data);
  return link;
}
