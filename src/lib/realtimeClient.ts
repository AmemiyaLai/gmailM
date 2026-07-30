import Pusher from "pusher-js";
import { buildEmailRowElement } from "./emailCardHtml";

type ConnectionState = "connecting" | "connected" | "failed";

let state: ConnectionState = "connecting";
let started = false;

function renderConnectionState() {
  const statusEl = document.getElementById("connection-status");
  if (!statusEl) return;

  const iconEl = statusEl.querySelector<HTMLElement>("[data-connection-icon]");
  const labelEl = statusEl.querySelector<HTMLElement>("[data-connection-label]");
  const connected = state === "connected";
  const label = connected
    ? "即時服務已連線"
    : state === "failed"
      ? "即時服務連線失敗"
      : "即時服務連線中";

  statusEl.dataset.state = state;
  statusEl.dataset.tooltip = label;
  statusEl.setAttribute("aria-label", label);
  if (iconEl) iconEl.textContent = connected ? "wifi" : "wifi_off";
  if (labelEl) labelEl.textContent = label;
}

export function startRealtimeConnection() {
  renderConnectionState();
  if (started) return;
  started = true;

  const pusher = new Pusher(import.meta.env.PUBLIC_PUSHER_KEY, {
    cluster: import.meta.env.PUBLIC_PUSHER_CLUSTER,
  });
  const channel = pusher.subscribe("gmail-channel");

  channel.bind("pusher:subscription_succeeded", () => {
    state = "connected";
    renderConnectionState();
  });

  channel.bind("pusher:subscription_error", () => {
    state = "failed";
    renderConnectionState();
  });

  channel.bind(
    "new-email",
    (data: {
      id: string;
      sender: string;
      subject: string;
      snippet: string;
      received_at: string;
      category?: string;
      is_important?: boolean;
      is_starred?: boolean;
      is_first_sender?: boolean;
    }) => {
      if (window.location.pathname !== "/") return;
      
      // 確保不重複插入
      const existing = document.querySelector(`.email-row[data-id="${data.id}"]`);
      if (existing) return;

      const newEl = buildEmailRowElement(data);
      // 加入動畫 class 提示新信
      newEl.classList.add("email-row--new-pulse");
      document.getElementById("email-list")?.prepend(newEl);
      
      // 5秒後移除動畫
      setTimeout(() => {
        newEl.classList.remove("email-row--new-pulse");
      }, 5000);
    },
  );

  channel.bind(
    "email-enriched",
    (data: {
      id: string;
      category: string | null;
      is_important: boolean;
      is_first_sender: boolean;
    }) => {
      if (window.location.pathname !== "/") return;
      const row = document.querySelector(`.email-row[data-id="${data.id}"]`) as HTMLDivElement | null;
      if (!row) return;

      // 更新重要性樣式
      if (data.is_important) {
        row.classList.add("email-row--important");
      } else {
        row.classList.remove("email-row--important");
      }

      // 動態更新 Badge 標籤
      const link = row.querySelector(".email-link");
      if (link) {
        // 先移除舊的 badge 晶片
        link.querySelectorAll(".badge.chip").forEach((badge) => badge.remove());

        // 新增分類 badge
        if (data.category) {
          const badgeEl = document.createElement("span");
          badgeEl.className = "badge chip";
          // 根據分類動態渲染顏色 (比照 categoryBadge)
          let bg = "var(--color-bg-tertiary)";
          let color = "var(--color-text-tertiary)";
          let label = data.category;
          if (data.category === "primary") {
            bg = "rgba(59,130,246,.15)";
            color = "#1d4ed8";
            label = "主要";
          } else if (data.category === "updates") {
            bg = "rgba(16,185,129,.15)";
            color = "#047857";
            label = "更新";
          } else if (data.category === "promotions") {
            bg = "rgba(245,158,11,.15)";
            color = "#b45309";
            label = "宣傳";
          } else if (data.category === "social") {
            bg = "rgba(139,92,246,.15)";
            color = "#6d28d9";
            label = "社群";
          } else if (data.category === "forums") {
            bg = "rgba(107,114,128,.15)";
            color = "#374151";
            label = "論壇";
          }
          badgeEl.style.background = bg;
          badgeEl.style.color = color;
          badgeEl.textContent = label;
          link.appendChild(badgeEl);
        }

        // 新增首次寄件者 badge
        if (data.is_first_sender) {
          const firstSenderEl = document.createElement("span");
          firstSenderEl.className = "badge chip";
          firstSenderEl.style.background = "rgba(249,115,22,.15)";
          firstSenderEl.style.color = "#c2410c";
          firstSenderEl.textContent = "首次寄件者";
          link.appendChild(firstSenderEl);
        }
      }
    },
  );

  channel.bind(
    "sync-complete",
    (data: { last_history_id: string; updated_at: string }) => {
      console.log(`[Pusher] 同步完成: history_id=${data.last_history_id}, 時間=${data.updated_at}`);
      const statusEl = document.getElementById("connection-status");
      if (statusEl && state === "connected") {
        const label = "即時服務已連線，郵件已同步";
        statusEl.dataset.tooltip = label;
        statusEl.setAttribute("aria-label", label);
        const labelEl = statusEl.querySelector<HTMLElement>("[data-connection-label]");
        if (labelEl) labelEl.textContent = label;
      }
    },
  );
}

document.addEventListener("astro:page-load", renderConnectionState);
