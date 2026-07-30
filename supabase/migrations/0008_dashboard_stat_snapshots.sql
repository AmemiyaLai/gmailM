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
