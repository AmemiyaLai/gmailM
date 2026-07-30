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
