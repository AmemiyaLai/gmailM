import { categoryBadge } from "./categoryBadge";
import { formatEmailDate } from "./formatEmailDate";

export interface NewEmailData {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  received_at: string;
  category?: string | null;
  is_important?: boolean;
  is_starred?: boolean;
  is_first_sender?: boolean;
}

export function renderEmailRowHtml(data: NewEmailData): string {
  const badge = categoryBadge(data.category ?? null);
  const isStarred = Boolean(data.is_starred);
  const formattedDate = formatEmailDate(data.received_at);

  return `
    <input type="checkbox" class="email-checkbox" aria-label="選取郵件" />

    <button type="button" class="star-btn" aria-label="加星號" aria-pressed="${isStarred ? "true" : "false"}">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="${isStarred ? "var(--color-warning)" : "none"}" stroke="var(--color-text-tertiary)" stroke-width="1.5">
        <polygon points="12 2 15.09 8.63 22 9.24 17 14.14 18.18 21 12 17.77 5.82 21 7 14.14 2 9.24 8.91 8.63 12 2" />
      </svg>
    </button>

    <a href="/emails/${encodeURIComponent(data.id)}" class="email-link">
      <span class="unread-dot"></span>
      <span class="email-sender">${data.sender}</span>
      <span class="email-subject">${data.subject || "(無主旨)"}</span>
      <span class="email-snippet">— ${data.snippet}</span>
      ${badge ? `<span class="badge chip" style="background:${badge.bg}; color:${badge.color};">${badge.label}</span>` : ""}
      ${data.is_first_sender ? '<span class="badge chip" style="background:rgba(249,115,22,.15); color:#c2410c;">首次寄件者</span>' : ""}
    </a>

    <div class="email-meta">
      <time class="email-date" datetime="${data.received_at}">${formattedDate}</time>
      <div class="email-actions">
        <button type="button" class="action-btn" data-action="read" title="標示為已讀">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 8l9 6 9-6M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
          </svg>
        </button>
        <button type="button" class="action-btn" data-action="archive" title="封存">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="4" rx="1" />
            <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 13h4" />
          </svg>
        </button>
        <button type="button" class="action-btn" data-action="trash" title="刪除">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
          </svg>
        </button>
      </div>
    </div>
  `;
}

export function buildEmailRowElement(data: NewEmailData): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "email-row email-row--unread";
  row.dataset.id = data.id;
  row.dataset.read = "false";
  row.dataset.starred = data.is_starred ? "true" : "false";
  if (data.is_important) {
    row.classList.add("email-row--important");
  }
  row.innerHTML = renderEmailRowHtml(data);
  return row;
}
