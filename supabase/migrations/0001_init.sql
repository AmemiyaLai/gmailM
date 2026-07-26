create table if not exists public.emails (
  id varchar(64) primary key,
  thread_id varchar(64) not null,
  sender varchar(255) not null,
  recipient varchar(255),
  subject text,
  snippet text,
  body_html text,
  body_plain text,
  labels jsonb default '[]'::jsonb,
  received_at timestamptz not null,
  is_read boolean default false,
  created_at timestamptz default current_timestamp
);

create index if not exists idx_emails_received_at on public.emails(received_at desc);
create index if not exists idx_emails_sender on public.emails(sender);
create index if not exists idx_emails_thread_id on public.emails(thread_id);

create table if not exists public.gmail_sync_state (
  watch_address varchar(255) primary key,
  last_history_id bigint,
  watch_expiration timestamptz,
  updated_at timestamptz default current_timestamp
);

alter table public.emails enable row level security;
alter table public.gmail_sync_state enable row level security;
