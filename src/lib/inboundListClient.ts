/**
 * 站點收件匣「別名管理」的前端互動：
 * 事件委派單一 click listener，儲存按鈕 → POST /api/inbound/alias。
 */

const RESET_DELAY_MS = 2_000;

export function initInboundAliasEditor(root: HTMLElement): void {
  if (root.dataset.aliasEditorInitialized === "true") return;
  root.dataset.aliasEditorInitialized = "true";

  root.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest?.<HTMLButtonElement>("[data-action='save-alias']");
    if (!button) return;

    const row = button.closest<HTMLElement>("[data-alias]");
    const alias = row?.dataset.alias;
    if (!row || !alias) return;

    const label = row.querySelector<HTMLInputElement>("input[name='label']")?.value ?? "";
    const site = row.querySelector<HTMLInputElement>("input[name='site']")?.value ?? "";

    const originalText = button.textContent;
    button.disabled = true;

    try {
      const res = await fetch("/api/inbound/alias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias, label, site }),
      });
      button.textContent = res.ok ? "已儲存" : "儲存失敗";
      if (!res.ok) console.error("別名儲存失敗：", res.status);
    } catch (err) {
      console.error("別名儲存失敗：", err);
      button.textContent = "儲存失敗";
    } finally {
      button.disabled = false;
      setTimeout(() => {
        button.textContent = originalText;
      }, RESET_DELAY_MS);
    }
  });
}
