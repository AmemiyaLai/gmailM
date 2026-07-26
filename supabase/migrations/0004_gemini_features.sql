alter table public.emails add column if not exists is_important boolean default false;
alter table public.emails add column if not exists importance_reason text;

create index if not exists idx_emails_is_important on public.emails(is_important);

create table if not exists public.email_summaries (
  id uuid primary key default gen_random_uuid(),
  summary_text text not null,
  email_count integer not null default 0,
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_at timestamptz default current_timestamp
);

create index if not exists idx_email_summaries_created_at on public.email_summaries(created_at desc);

alter table public.email_summaries enable row level security;
