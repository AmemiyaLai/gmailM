type BulkAction = "read" | "archive" | "trash";

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
      const result = await res.json();
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
    } catch (err) {
      console.error(`Bulk ${action} failed:`, err);
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
      } catch (err) {
        console.error("Star toggle failed:", err);
        setStarVisual(starBtn, wasStarred);
        row.dataset.starred = wasStarred ? "true" : "false";
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
          }
        } catch (err) {
          console.error("Read toggle failed:", err);
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
