type BulkAction = "read" | "archive" | "trash";

type ToastKind = "error" | "warn";

const ACTION_LABEL: Record<BulkAction, string> = {
  read: "標示已讀",
  archive: "封存",
  trash: "刪除",
};

/**
 * 顯示一則短暫的提示訊息。刻意不拋出任何例外 —— 提示失敗絕不能連帶讓
 * 郵件操作本身失敗。
 */
export function showToast(message: string, kind: ToastKind = "error"): void {
  try {
    let host = document.querySelector(".toast-host");
    if (!host) {
      host = document.createElement("div");
      host.className = "toast-host";
      document.body.appendChild(host);
    }

    const el = document.createElement("div");
    el.className = `toast toast--${kind}`;
    el.setAttribute("role", "alert");
    el.textContent = message;
    host.appendChild(el);

    setTimeout(() => el.remove(), 5000);
  } catch (err) {
    console.error("showToast failed:", err, message);
  }
}

/** 207 代表 DB 已寫入但 Gmail 同步失敗；res.ok 為 true，不能只靠它判斷。 */
function warnIfGmailSyncFailed(res: Response, result: { gmailSync?: string; gmailError?: string }, what: string): void {
  if (res.status !== 207 && result.gmailSync !== "failed") return;
  // gmailError 可能含敏感資訊，只寫進 console 不顯示給使用者
  console.warn(`Gmail 同步失敗（${what}）:`, result.gmailError);
  showToast(`${what}已在網站更新，但同步到 Gmail 失敗`, "warn");
}

function setStarVisual(btn: Element, starred: boolean) {
  const icon = btn.querySelector(".star-icon");
  if (icon) {
    icon.classList.toggle("starred", starred);
  }
  btn.setAttribute("aria-pressed", starred ? "true" : "false");
}

function syncGroupSelectAll(group: HTMLElement) {
  const checkboxes = group.querySelectorAll<HTMLInputElement>(".email-checkbox");
  const selectAll = group.querySelector<HTMLInputElement>(".group-select-all");
  if (!selectAll || checkboxes.length === 0) return;

  const checkedCount = Array.from(checkboxes).filter((cb) => cb.checked).length;
  selectAll.checked = checkedCount === checkboxes.length;
  selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
}

export function initEmailList(container: HTMLElement): void {
  if (container.dataset.emailListInitialized === "true") return;
  container.dataset.emailListInitialized = "true";

  const selected = new Set<string>();
  const unreadOnly = container.dataset.unreadOnly === "true";

  const toolbar = document.createElement("div");
  toolbar.className = "bulk-toolbar";
  toolbar.innerHTML = `
    <span class="bulk-toolbar-count"></span>
    <button type="button" class="btn btn-outline" data-bulk="read">標示已讀</button>
    <button type="button" class="btn btn-outline" data-bulk="archive">封存</button>
    <button type="button" class="btn btn-outline" data-bulk="trash">刪除</button>
  `;
  container.parentElement?.insertBefore(toolbar, container);
  const countEl = toolbar.querySelector(".bulk-toolbar-count") as HTMLElement;

  function updateToolbar() {
    toolbar.classList.toggle("bulk-toolbar--visible", selected.size > 0);
    countEl.textContent = `已選取 ${selected.size} 封`;
  }

  function getRow(id: string): HTMLElement | null {
    return container.querySelector(`[data-id="${CSS.escape(id)}"]`);
  }

  function removeRow(row: HTMLElement) {
    const group = row.closest("details.sender-group") as HTMLElement | null;
    row.remove();
    if (!group) return;
    const remaining = group.querySelectorAll(".email-row").length;
    if (remaining === 0) {
      group.remove();
      return;
    }
    const badge = group.querySelector(".sender-group-header .badge") as HTMLElement | null;
    if (badge) badge.textContent = `${remaining} 封`;
  }

  async function runBulkAction(ids: string[], action: BulkAction) {
    if (ids.length === 0) return;
    try {
      const res = await fetch("/api/emails/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error(`Bulk ${action} failed with status ${res.status}`);
        showToast(`批次${ACTION_LABEL[action]}失敗`, "error");
        return;
      }
      const succeeded: string[] = result.succeeded ?? [];
      for (const id of succeeded) {
        const row = getRow(id);
        selected.delete(id);
        if (!row) continue;
        if (action === "read") {
          if (unreadOnly) {
            removeRow(row);
          } else {
            row.dataset.read = "true";
            row.classList.remove("email-row--unread");
            const checkbox = row.querySelector(".email-checkbox") as HTMLInputElement | null;
            if (checkbox) checkbox.checked = false;
          }
        } else {
          removeRow(row);
        }
      }

      const gmailFailed: string[] = result.gmailFailed ?? [];
      if (gmailFailed.length > 0) {
        showToast(`${gmailFailed.length} 封已在網站${ACTION_LABEL[action]}，但未同步到 Gmail`, "warn");
      }
    } catch (err) {
      console.error(`Bulk ${action} failed:`, err);
      showToast("網路錯誤，操作未完成", "error");
    } finally {
      updateToolbar();
    }
  }

  container.addEventListener("change", (e) => {
    const target = e.target as HTMLElement;

    if (target.matches(".group-select-all")) {
      const details = target.closest("details.sender-group");
      if (details) {
        const checkboxes = details.querySelectorAll<HTMLInputElement>(".email-checkbox");
        const checked = (target as HTMLInputElement).checked;
        checkboxes.forEach((cb) => {
          cb.checked = checked;
          const row = cb.closest("[data-id]") as HTMLElement | null;
          if (row) {
            const id = row.dataset.id!;
            if (checked) {
              selected.add(id);
            } else {
              selected.delete(id);
            }
          }
        });
        updateToolbar();
      }
      return;
    }

    if (target.matches(".email-checkbox")) {
      const row = target.closest("[data-id]") as HTMLElement | null;
      if (!row) return;
      const id = row.dataset.id!;
      if ((target as HTMLInputElement).checked) {
        selected.add(id);
      } else {
        selected.delete(id);
      }
      updateToolbar();

      const group = target.closest("details.sender-group") as HTMLElement | null;
      if (group) syncGroupSelectAll(group);
    }
  });

  container.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;

    const starBtn = target.closest(".star-btn") as HTMLElement | null;
    if (starBtn) {
      e.preventDefault();
      e.stopPropagation();
      const row = starBtn.closest("[data-id]") as HTMLElement;
      const id = row.dataset.id!;
      const wasStarred = row.dataset.starred === "true";
      const nextStarred = !wasStarred;
      setStarVisual(starBtn, nextStarred);
      row.dataset.starred = nextStarred ? "true" : "false";
      try {
        const res = await fetch(`/api/emails/${encodeURIComponent(id)}/star`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starred: nextStarred }),
        });
        if (!res.ok) throw new Error("star request failed");
        // DB 已寫入，UI 保留新狀態；僅在 Gmail 同步失敗時額外提示
        warnIfGmailSyncFailed(res, await res.json().catch(() => ({})), "星號");
      } catch (err) {
        console.error("Star toggle failed:", err);
        setStarVisual(starBtn, wasStarred);
        row.dataset.starred = wasStarred ? "true" : "false";
        showToast("星號更新失敗", "error");
      }
      return;
    }

    const actionBtn = target.closest(".action-btn") as HTMLElement | null;
    if (actionBtn) {
      e.preventDefault();
      e.stopPropagation();
      const row = actionBtn.closest("[data-id]") as HTMLElement;
      const action = actionBtn.dataset.action as string;
      const id = row.dataset.id!;

      if (action === "read") {
        const isCurrentlyRead = row.dataset.read === "true";
        const nextRead = !isCurrentlyRead;
        try {
          const res = await fetch(`/api/emails/${encodeURIComponent(id)}/read`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ read: nextRead }),
          });
          if (res.ok) {
            if (nextRead && unreadOnly) {
              removeRow(row);
            } else {
              row.dataset.read = nextRead ? "true" : "false";
              row.classList.toggle("email-row--unread", !nextRead);
              actionBtn.title = nextRead ? "標示為未讀" : "標示為已讀";
            }
            warnIfGmailSyncFailed(res, await res.json().catch(() => ({})), "已讀狀態");
          } else {
            console.error(`Read toggle failed with status ${res.status}`);
            showToast("標示已讀失敗", "error");
          }
        } catch (err) {
          console.error("Read toggle failed:", err);
          showToast("標示已讀失敗", "error");
        }
      } else {
        await runBulkAction([id], action as BulkAction);
      }
    }
  });

  toolbar.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest("[data-bulk]") as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.bulk as BulkAction;
    await runBulkAction(Array.from(selected), action);
  });
}
