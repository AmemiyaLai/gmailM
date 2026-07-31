/**
 * /reviews 頁面的前端互動：事件委派單一 click listener。
 *
 * 兩種按鈕：
 * - [data-action="decide"]：對某則 pending 審核單整批確認／取消 → POST /api/cleanup/review
 * - [data-action="process-now"]：直接處理尚未送審的候選郵件 → POST /api/cleanup/process-now
 *
 * 成功後整頁重載，讓 pending 清單、候選清單與首頁統計都取得最新狀態。
 */

const RELOAD_DELAY_MS = 800;
const RESET_DELAY_MS = 2_500;

function setStatus(root: HTMLElement, text: string, tone: "info" | "error" = "info"): void {
  const status = root.querySelector<HTMLElement>("#review-status");
  if (!status) return;
  status.textContent = text;
  status.style.color = tone === "error" ? "var(--color-error)" : "var(--color-text-tertiary)";
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "請求失敗");
  return data;
}

/** 依伺服器回傳組出使用者看得懂的結果訊息 */
function describeDecision(decision: string, data: Record<string, unknown>): string {
  if (data.status === "already-handled") {
    return "這則審核剛剛已被處理（可能是在 Discord 上按過了）。";
  }
  if (decision === "approve") {
    const processed = Number(data.processedCount ?? 0);
    const failed = Number(data.failedCount ?? 0);
    const verb = data.action === "read" ? "標記為已讀" : "移至垃圾桶";
    return failed > 0
      ? `已${verb} ${processed} 封，另有 ${failed} 封失敗。`
      : `已${verb} ${processed} 封。`;
  }
  return `已取消，${Number(data.emailCount ?? 0)} 封郵件保持原狀。`;
}

function describeProcessNow(data: Record<string, unknown>): string {
  if (data.status === "skipped") {
    return "目前沒有尚未送審的候選郵件。";
  }
  const processed = Number(data.processedCount ?? 0);
  const failed = Number(data.failedCount ?? 0);
  const verb = data.action === "read" ? "標記為已讀" : "移至垃圾桶";
  return failed > 0
    ? `已${verb} ${processed} 封，另有 ${failed} 封失敗。`
    : `已${verb} ${processed} 封。`;
}

export function initReviewList(root: HTMLElement): void {
  if (root.dataset.reviewListInitialized === "true") return;
  root.dataset.reviewListInitialized = "true";

  root.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest?.<HTMLButtonElement>("[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    if (action !== "decide" && action !== "process-now") return;

    const originalText = button.textContent;
    button.disabled = true;

    try {
      if (action === "decide") {
        const reviewId = button.closest<HTMLElement>("[data-review-id]")?.dataset.reviewId;
        const decision = button.dataset.decision;
        if (!reviewId || (decision !== "approve" && decision !== "reject")) return;

        button.textContent = "處理中…";
        setStatus(root, "處理中…");
        const data = await postJson("/api/cleanup/review", { reviewId, decision });
        setStatus(root, describeDecision(decision, data));
      } else {
        const cleanupAction = button.dataset.cleanupAction;
        if (cleanupAction !== "trash" && cleanupAction !== "read") return;

        button.textContent = "處理中…";
        setStatus(root, "處理中…");
        const data = await postJson("/api/cleanup/process-now", { action: cleanupAction });
        setStatus(root, describeProcessNow(data));
      }

      setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    } catch (err) {
      console.error("審核操作失敗：", err);
      setStatus(root, err instanceof Error ? err.message : "操作失敗，請稍後再試。", "error");
      button.textContent = originalText;
      button.disabled = false;
      setTimeout(() => setStatus(root, ""), RESET_DELAY_MS);
    }
  });
}
