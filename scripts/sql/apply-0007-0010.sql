-- 補套用 migration 0007-0010 到線上 Supabase
-- 全部使用 if not exists / add column if not exists，可安全重複執行

-- ═══════════ 0007_cleanup_keywords.sql ═══════════
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

-- ═══════════ 0008_dashboard_stat_snapshots.sql ═══════════
create table if not exists public.dashboard_stat_snapshots (
  id bigint generated always as identity primary key,
  recorded_at timestamptz not null default current_timestamp,
  unread_count integer not null,
  today_count integer not null,
  group_counts jsonb not null default '{}'::jsonb,
  category_counts jsonb not null default '{}'::jsonb
);

create index if not exists idx_dashboard_stat_snapshots_recorded_at
  on public.dashboard_stat_snapshots(recorded_at desc);

alter table public.dashboard_stat_snapshots enable row level security;

-- ═══════════ 0009_sender_trust.sql ═══════════
-- 寄件者可信度判定：Gmail 驗證標頭 + Google Safe Browsing + 本地知名網域白名單
--
-- 原始證據（Authentication-Results 原文）保存在 emails，判定結果掛在
-- first_sender_events。這讓日後調整判定規則時可以零 Gmail API 呼叫重跑全量重評。

-- ── 原始證據 ──────────────────────────────────────────────────────────────
alter table public.emails add column if not exists authentication_results text;
alter table public.emails add column if not exists received_spf text;

-- ── 判定結果（PK 已是 sender_address，頁面直讀免 join）────────────────────
alter table public.first_sender_events add column if not exists trust_level varchar(16);
alter table public.first_sender_events add column if not exists spf_result varchar(16);
alter table public.first_sender_events add column if not exists dkim_result varchar(16);
alter table public.first_sender_events add column if not exists dmarc_result varchar(16);
alter table public.first_sender_events add column if not exists auth_domain varchar(253);
alter table public.first_sender_events
  add column if not exists trust_evidence jsonb not null default '[]'::jsonb;
alter table public.first_sender_events add column if not exists trust_evaluated_at timestamptz;

-- trust_level 允許 null，代表「尚未評估」；由回填 route 補齊。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'first_sender_events_trust_level_check'
  ) then
    alter table public.first_sender_events
      add constraint first_sender_events_trust_level_check
      check (
        trust_level is null
        or trust_level in ('trusted', 'likely', 'unverified', 'suspicious', 'dangerous')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'first_sender_events_auth_result_check'
  ) then
    alter table public.first_sender_events
      add constraint first_sender_events_auth_result_check
      check (
        coalesce(spf_result, 'none') in
          ('pass','fail','softfail','neutral','none','temperror','permerror','policy')
        and coalesce(dkim_result, 'none') in
          ('pass','fail','softfail','neutral','none','temperror','permerror','policy')
        and coalesce(dmarc_result, 'none') in
          ('pass','fail','softfail','neutral','none','temperror','permerror','policy')
      );
  end if;
end $$;

create index if not exists idx_first_sender_events_trust_level
  on public.first_sender_events(trust_level);

-- 回填掃描專用：只索引尚未評估的列
create index if not exists idx_first_sender_events_trust_pending
  on public.first_sender_events(first_received_at desc)
  where trust_level is null;

-- ── 外部信譽以「網域」為快取單位，不隨寄件者重複查 ────────────────────────
create table if not exists public.domain_reputation (
  domain varchar(253) primary key,
  provider varchar(32) not null default 'google_safe_browsing',
  verdict varchar(16) not null check (verdict in ('clean', 'threat', 'unknown', 'error')),
  threat_types text[] not null default '{}',
  raw_response jsonb,
  error_message text,
  checked_at timestamptz not null default current_timestamp,
  expires_at timestamptz not null,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp
);

create index if not exists idx_domain_reputation_expires_at
  on public.domain_reputation(expires_at);

alter table public.domain_reputation enable row level security;

-- ═══════════ 0010_inbound_emails.sql ═══════════
create table if not exists public.inbound_aliases (
  alias varchar(64) primary key,
  label varchar(64) not null default '未分類',
  site varchar(128),
  note text,
  color varchar(16),
  is_active boolean not null default true,
  message_count integer not null default 0,
  last_received_at timestamptz,
  created_at timestamptz not null default current_timestamp,
  constraint chk_inbound_aliases_alias check (alias ~ '^[a-z0-9][a-z0-9._-]{0,63}$')
);

create table if not exists public.inbound_emails (
  id uuid primary key default gen_random_uuid(),
  message_id varchar(255) not null,
  alias varchar(64) not null references public.inbound_aliases(alias),
  from_address varchar(255) not null,
  from_display varchar(255),
  to_addresses jsonb not null default '[]'::jsonb,
  subject text,
  snippet text,
  body_html text,
  body_plain text,
  -- 只存感興趣的標頭（reply-to / spf / dkim / dmarc 等），非全量
  headers jsonb not null default '{}'::jsonb,
  -- [{filename, mime_type, size, storage_path|null, dropped}]
  attachments jsonb not null default '[]'::jsonb,
  has_attachments boolean not null default false,
  is_read boolean not null default false,
  received_at timestamptz not null,
  created_at timestamptz not null default current_timestamp
);

create unique index if not exists idx_inbound_emails_message_id on public.inbound_emails(message_id);
create index if not exists idx_inbound_emails_alias_received on public.inbound_emails(alias, received_at desc);
create index if not exists idx_inbound_emails_received_at on public.inbound_emails(received_at desc);
create index if not exists idx_inbound_emails_created_at on public.inbound_emails(created_at desc);

alter table public.inbound_aliases enable row level security;
alter table public.inbound_emails enable row level security;

-- 附件私有 bucket：service-role 上傳、簽名 URL 下載
insert into storage.buckets (id, name, public)
  values ('inbound-attachments', 'inbound-attachments', false)
  on conflict (id) do nothing;

