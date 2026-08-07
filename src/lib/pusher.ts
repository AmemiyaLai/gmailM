import Pusher from "pusher";
import { env, envOr } from "./env";

let pusher: Pusher | null = null;

/**
 * 伺服器端 Pusher client。
 *
 * 未設定 PUSHER_HOST 時走 Pusher 雲端（依 cluster 解析位址），與原行為完全相同。
 * 設定後改連自架的 Pusher 相容服務（例如 soketi），供完全自托管的部署使用；
 * 對應的前端設定在 realtimeClient.ts 的 PUBLIC_PUSHER_HOST。
 */
export function getPusher() {
  if (!pusher) {
    const host = env("PUSHER_HOST");
    const port = env("PUSHER_PORT");

    pusher = new Pusher({
      appId: envOr("PUSHER_APP_ID"),
      key: envOr("PUSHER_KEY"),
      secret: envOr("PUSHER_SECRET"),
      ...(host
        ? {
            host,
            ...(port ? { port } : {}),
            // 自架服務多半跑在反向代理後方或同機明文通訊，由 PUSHER_USE_TLS 明確指定
            useTLS: env("PUSHER_USE_TLS") === "true",
          }
        : { cluster: envOr("PUSHER_CLUSTER"), useTLS: true }),
    });
  }
  return pusher;
}
