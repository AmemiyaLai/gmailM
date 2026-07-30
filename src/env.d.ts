/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly SUPABASE_URL: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  readonly PUSHER_APP_ID: string;
  readonly PUSHER_KEY: string;
  readonly PUSHER_SECRET: string;
  readonly PUSHER_CLUSTER: string;
  readonly PUBLIC_PUSHER_KEY: string;
  readonly PUBLIC_PUSHER_CLUSTER: string;
  readonly GMAIL_OAUTH_CLIENT_ID: string;
  readonly GMAIL_OAUTH_CLIENT_SECRET: string;
  readonly GMAIL_OAUTH_REFRESH_TOKEN: string;
  readonly GMAIL_WATCH_ADDRESS: string;
  readonly GCP_PROJECT_ID: string;
  readonly PUBSUB_TOPIC: string;
  readonly PUBSUB_AUDIENCE: string;
  /** Pub/Sub 訂閱上 pushConfig.oidcToken.serviceAccountEmail 設定的 service account */
  readonly PUBSUB_PUSH_SERVICE_ACCOUNT: string;
  readonly CRON_SECRET: string;
  readonly DISCORD_WEBHOOK_URL: string;
  readonly DISCORD_BOT_TOKEN?: string;
  readonly DISCORD_CLEANUP_CHANNEL_ID?: string;
  readonly DISCORD_PUBLIC_KEY?: string;
  readonly GEMINI_API_KEY: string;
  readonly GEMINI_MODEL?: string;
  /** Google Safe Browsing Lookup API v4 金鑰；未設定時略過外部信譽查詢 */
  readonly SAFE_BROWSING_API_KEY?: string;
  /** Cloudflare Email Worker 呼叫 inbound webhook 的 Bearer secret */
  readonly INBOUND_EMAIL_WEBHOOK_SECRET: string;
  /** 自架收件網域，用於從 to[] 抽取別名；未設定時預設 autodesignlab.org */
  readonly INBOUND_EMAIL_DOMAIN?: string;
  readonly SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
