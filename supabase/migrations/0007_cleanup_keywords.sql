-- 關鍵字郵件清理 + Discord 審核（刪除 / 標記已讀）
-- cleanup_keywords：使用者自訂的清理關鍵字（由 /cleanup 頁面維護），每筆關鍵字綁定一個動作
-- cleanup_reviews：每次送到 Discord 的審核單，記錄涵蓋郵件與最終處理結果

create table if not exists public.cleanup_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword varchar(128) not null,
  field varchar(16) not null default 'any'
    check (field in ('any', 'subject', 'sender', 'snippet')),
  action varchar(16) not null default 'trash'
    check (action in ('trash', 'read')),
  enabled boolean not null default true,
  created_at timestamptz not null default current_timestamp,
  unique (keyword, action)
);

create table if not exists public.cleanup_reviews (
  id uuid primary key default gen_random_uuid(),
  action varchar(16) not null default 'trash'
    check (action in ('trash', 'read')),
  status varchar(16) not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'failed')),
  email_ids jsonb not null,
  matched jsonb not null,
  email_count integer not null,
  discord_message_id text,
  processed_count integer,
  last_error text,
  created_at timestamptz not null default current_timestamp,
  decided_at timestamptz
);

create index if not exists idx_cleanup_keywords_enabled on public.cleanup_keywords(enabled);
create index if not exists idx_cleanup_reviews_status on public.cleanup_reviews(status);
create index if not exists idx_cleanup_reviews_created_at on public.cleanup_reviews(created_at desc);

alter table public.cleanup_keywords enable row level security;
alter table public.cleanup_reviews enable row level security;
