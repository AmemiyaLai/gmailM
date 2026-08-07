import { env } from "./env";

/**
 * Gmail webhook 與排程的總開關。預設關閉，避免設定遺漏時持續消耗 API 配額與 serverless 流量。
 * 僅在部署環境明確設定 GMAIL_AUTOMATION_ENABLED=true 才恢復自動收信與排程同步。
 */
export function isGmailAutomationEnabled(): boolean {
  return env("GMAIL_AUTOMATION_ENABLED") === "true";
}

export function gmailAutomationPausedResponse(): Response {
  return new Response(JSON.stringify({ status: "paused", reason: "gmail automation disabled" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
