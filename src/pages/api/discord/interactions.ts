import type { APIRoute } from "astro";
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { approveReview, getReview, rejectReview } from "../../../lib/cleanupReview";
import { buildCleanupResultEmbed } from "../../../lib/discord";

/**
 * Discord Interactions Endpoint。
 * 在 Developer Portal 設為 https://<site>/api/discord/interactions；
 * Discord 會先送一則 PING，簽章驗證通過並回 200 才會接受此端點。
 */

const INTERACTION_PING = 1;
const INTERACTION_MESSAGE_COMPONENT = 3;
const RESPONSE_PONG = 1;
const RESPONSE_CHANNEL_MESSAGE = 4;
const RESPONSE_UPDATE_MESSAGE = 7;
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

function updateMessage(embed: Record<string, unknown>): Response {
  // type 7 = UPDATE_MESSAGE：就地覆寫原訊息，components 清空避免重複點擊
  return json({ type: RESPONSE_UPDATE_MESSAGE, data: { embeds: [embed], components: [] } });
}

function ephemeral(content: string): Response {
  return json({ type: RESPONSE_CHANNEL_MESSAGE, data: { content, flags: EPHEMERAL } });
}

async function handledEmbed(reviewId: string): Promise<Response> {
  const review = await getReview(reviewId);
  return updateMessage(buildCleanupResultEmbed(review?.action ?? "trash", "already-handled"));
}

async function handleCleanupAction(action: string, reviewId: string): Promise<Response> {
  if (action === "approve") {
    const result = await approveReview(reviewId);
    if (result.status === "already-handled") return handledEmbed(reviewId);
    if (result.status === "approved") {
      return updateMessage(buildCleanupResultEmbed(result.action, "approved", {
        processedCount: result.processedCount,
        failedCount: result.failedCount,
      }));
    }
  }
  if (action === "reject") {
    const result = await rejectReview(reviewId);
    if (result.status === "already-handled") return handledEmbed(reviewId);
    if (result.status === "rejected") {
      return updateMessage(buildCleanupResultEmbed(result.action, "rejected", { emailCount: result.emailCount }));
    }
  }
  return ephemeral("無法辨識的按鈕動作。");
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

  let interaction: { type?: number; data?: { custom_id?: string } };
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

  try {
    return await handleCleanupAction(action, reviewId);
  } catch (err) {
    console.error("Discord interactions: 處理清理審核失敗:", err);
    return ephemeral("處理失敗，請稍後再試或改到 /cleanup 頁面確認狀態。");
  }
};
