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
      <span class="material-symbols-rounded email-action-icon star-icon${isStarred ? " starred" : ""}" aria-hidden="true">star</span>
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
          <span class="material-symbols-rounded email-action-icon" aria-hidden="true">mail</span>
        </button>
        <button type="button" class="action-btn" data-action="archive" title="封存">
          <span class="material-symbols-rounded email-action-icon" aria-hidden="true">archive</span>
        </button>
        <button type="button" class="action-btn" data-action="trash" title="刪除">
          <span class="material-symbols-rounded email-action-icon" aria-hidden="true">delete</span>
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
