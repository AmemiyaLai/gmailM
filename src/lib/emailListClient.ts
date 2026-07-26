type BulkAction = "read" | "archive" | "trash";

function setStarVisual(btn: Element, starred: boolean) {
  const svg = btn.querySelector("svg");
  if (svg) {
    svg.setAttribute("fill", starred ? "var(--color-warning)" : "none");
  }
  btn.setAttribute("aria-pressed", starred ? "true" : "false");
}

export function initEmailList(container: HTMLElement): void {
  const selected = new Set<string>();

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
          row.dataset.read = "true";
          row.classList.remove("email-row--unread");
          const checkbox = row.querySelector(".email-checkbox") as HTMLInputElement | null;
          if (checkbox) checkbox.checked = false;
        } else {
          row.remove();
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
    if (!target.matches(".email-checkbox")) return;
    const row = target.closest("[data-id]") as HTMLElement | null;
    if (!row) return;
    const id = row.dataset.id!;
    if ((target as HTMLInputElement).checked) {
      selected.add(id);
    } else {
      selected.delete(id);
    }
    updateToolbar();
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
      const action = actionBtn.dataset.action as BulkAction;
      await runBulkAction([row.dataset.id!], action);
    }
  });

  toolbar.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest("[data-bulk]") as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.bulk as BulkAction;
    await runBulkAction(Array.from(selected), action);
  });
}
