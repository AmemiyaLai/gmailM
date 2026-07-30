import type { APIRoute } from "astro";
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { approveReview, getReview, rejectReview } from "../../../lib/cleanupReview";
import { buildCleanupResultEmbed, editInteractionMessage } from "../../../lib/discord";

/**
 * Discord Interactions Endpoint。
 * 在 Developer Portal → General Information 設為 https://<site>/api/discord/interactions；
 * Discord 會先送一則 PING，簽章驗證通過並回 200 才會接受此端點。
 *
 * ## 為什麼用 deferred response
 * Discord 要求 3 秒內回應，但按下「確認刪除」最多要跑 25 次 Gmail API 加數次 Supabase 查詢，
 * 加上 serverless 冷啟動很可能超時。超時的後果特別糟：動作其實已經做完（郵件已刪），
 * 但使用者只看到「應用程式未及時回應」，訊息也沒更新。
 *
 * 因此改為：立刻回 DEFERRED_UPDATE_MESSAGE（type 6）→ 背景完成處理 → 用 interaction token
 * 回寫原訊息。type 6 不會顯示「思考中」，訊息維持原狀直到回寫完成。
 */

const INTERACTION_PING = 1;
const INTERACTION_MESSAGE_COMPONENT = 3;
const RESPONSE_PONG = 1;
const RESPONSE_CHANNEL_MESSAGE = 4;
const RESPONSE_DEFERRED_UPDATE_MESSAGE = 6;
const EPHEMERAL = 64;

/** 把 Discord 提供的 32 byte 原始 ed25519 公鑰包成 SPKI DER 供 node:crypto 使用 */
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function verifySignature(rawBody: string, signature: string, timestamp: string, publicKeyHex: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return cryptoVerify(
      null,
      Buffer.from(timestamp + rawBody),
      key,
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ephemeral(content: string): Response {
  return json({ type: RESPONSE_CHANNEL_MESSAGE, data: { content, flags: EPHEMERAL } });
}

/**
 * 讓背景工作在回應送出後繼續執行。
 * 回傳非 undefined 代表呼叫端必須自行 await（本機開發等沒有 waitUntil 的環境，
 * 那些環境也沒有 3 秒限制的顧慮）。
 */
function runAfterResponse(work: Promise<unknown>): Promise<unknown> | undefined {
  try {
    waitUntil(work);
    return undefined;
  } catch {
    // waitUntil 在非 Vercel 執行環境會拋錯，此時只能同步等完
    return work;
  }
}

/** 實際處理按鈕動作，完成後回寫原訊息。任何錯誤都只記錄，不讓 rejection 逸出。 */
async function handleCleanupDecision(
  action: "approve" | "reject",
  reviewId: string,
  applicationId: string,
  interactionToken: string,
): Promise<void> {
  try {
    let embed: Record<string, unknown>;

    if (action === "approve") {
      const result = await approveReview(reviewId);
      if (result.status === "approved") {
        embed = buildCleanupResultEmbed(result.action, "approved", {
          processedCount: result.processedCount,
          failedCount: result.failedCount,
        });
      } else {
        const review = await getReview(reviewId);
        embed = buildCleanupResultEmbed(review?.action ?? "trash", "already-handled");
      }
    } else {
      const result = await rejectReview(reviewId);
      if (result.status === "rejected") {
        embed = buildCleanupResultEmbed(result.action, "rejected", { emailCount: result.emailCount });
      } else {
        const review = await getReview(reviewId);
        embed = buildCleanupResultEmbed(review?.action ?? "trash", "already-handled");
      }
    }

    await editInteractionMessage(applicationId, interactionToken, embed);
  } catch (err) {
    console.error(`Discord interactions: 處理清理審核失敗 (${action} ${reviewId}):`, err);
    // 動作可能已部分完成，盡力把狀況回寫給使用者；連回寫都失敗就只留 log
    await editInteractionMessage(applicationId, interactionToken, {
      title: "🧹 關鍵字清理審核",
      description: "⚠️ 處理時發生錯誤，請到 /cleanup 查看審核記錄與實際結果。",
      color: 0xed4245,
      timestamp: new Date().toISOString(),
    }).catch((patchErr) => {
      console.error("Discord interactions: 錯誤訊息回寫也失敗:", patchErr);
    });
  }
}

export const POST: APIRoute = async ({ request }) => {
  const publicKey = import.meta.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    console.error("Discord interactions: DISCORD_PUBLIC_KEY 未設定");
    return new Response("Not configured", { status: 500 });
  }

  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  // 必須以原始 body 驗簽，不可先行 JSON 解析
  const rawBody = await request.text();

  if (!signature || !timestamp || !verifySignature(rawBody, signature, timestamp, publicKey)) {
    return new Response("invalid request signature", { status: 401 });
  }

  let interaction: {
    type?: number;
    token?: string;
    application_id?: string;
    data?: { custom_id?: string };
  };
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (interaction.type === INTERACTION_PING) {
    return json({ type: RESPONSE_PONG });
  }

  if (interaction.type !== INTERACTION_MESSAGE_COMPONENT) {
    return ephemeral("不支援的互動類型。");
  }

  const customId = interaction.data?.custom_id ?? "";
  const [namespace, action, reviewId] = customId.split(":");
  if (namespace !== "cleanup" || !reviewId) {
    return ephemeral("無法辨識的按鈕。");
  }
  if (action !== "approve" && action !== "reject") {
    return ephemeral("無法辨識的按鈕動作。");
  }

  const applicationId = interaction.application_id;
  const interactionToken = interaction.token;
  if (!applicationId || !interactionToken) {
    console.error("Discord interactions: 互動缺少 application_id 或 token");
    return ephemeral("互動資料不完整，請稍後再試。");
  }

  // 先排定背景工作，再立刻回 ACK，確保處理不受 3 秒限制拘束
  const mustAwait = runAfterResponse(
    handleCleanupDecision(action, reviewId, applicationId, interactionToken),
  );
  if (mustAwait) await mustAwait;

  return json({ type: RESPONSE_DEFERRED_UPDATE_MESSAGE });
};
