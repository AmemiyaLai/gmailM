-- 補套用 migration 0011-0012 到線上 Supabase
-- 全部 if not exists / create or replace，可安全重複執行

-- ═══════════ 0011_chinese_substring_search.sql ═══════════
create extension if not exists pg_trgm;

alter table public.emails
  add column if not exists search_text text
  generated always as (
    coalesce(sender, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(snippet, '')
  ) stored;

create index if not exists idx_emails_search_text_trgm
  on public.emails using gin (search_text gin_trgm_ops);

-- ═══════════ 0012_gmail_unread_thread_sync.sql ═══════════
alter table public.gmail_sync_state
  add column if not exists inbox_threads_unread integer,
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists reconciliation_status text not null default 'idle'
    check (reconciliation_status in ('idle', 'running', 'failed')),
  add column if not exists recovery_history_id bigint,
  add column if not exists last_sync_error text;

create index if not exists idx_emails_unread_inbox
  on public.emails (thread_id, received_at desc)
  where is_read = false and labels @> '["INBOX"]'::jsonb;

create or replace view public.unread_inbox_threads
with (security_invoker = true)
as
select distinct on (thread_id)
  id,
  thread_id,
  sender,
  recipient,
  subject,
  snippet,
  body_html,
  body_plain,
  labels,
  received_at,
  is_read,
  created_at,
  category,
  is_important,
  importance_reason,
  is_first_sender,
  sender_address,
  authentication_results,
  received_spf
from public.emails
where is_read = false
  and labels @> '["INBOX"]'::jsonb
order by thread_id, received_at desc;

