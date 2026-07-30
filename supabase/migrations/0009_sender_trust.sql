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
