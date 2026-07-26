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
  readonly CRON_SECRET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
