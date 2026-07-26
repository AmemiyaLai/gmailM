alter table public.emails add column if not exists sender_address varchar(254);
alter table public.emails add column if not exists is_first_sender boolean not null default false;

-- 只接受可辨識的 RFC 5322 常見地址形式；原始 From 標頭仍保留在 emails.sender。
update public.emails
set sender_address = lower(coalesce(
  (regexp_match(sender, '<[[:space:]]*([^<>()[:space:]]+@[^<>()[:space:]]+)[[:space:]]*>'))[1],
  (regexp_match(sender, '([A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+)'))[1]
))
where sender_address is null and sender is not null;

create index if not exists idx_emails_sender_address on public.emails(sender_address);

create table if not exists public.first_sender_events (
  sender_address varchar(254) primary key,
  first_email_id varchar(64) not null references public.emails(id),
  sender_display varchar(255) not null,
  first_received_at timestamptz not null,
  source varchar(16) not null check (source in ('baseline', 'live')),
  notification_status varchar(16) not null check (notification_status in ('baseline', 'pending', 'failed', 'sent')),
  notification_attempts integer not null default 0,
  last_notification_error text,
  notified_at timestamptz,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp
);

create index if not exists idx_first_sender_events_notification
  on public.first_sender_events(notification_status, created_at);
create index if not exists idx_first_sender_events_received_at
  on public.first_sender_events(first_received_at desc);

insert into public.first_sender_events (
  sender_address, first_email_id, sender_display, first_received_at, source, notification_status
)
select distinct on (sender_address)
  sender_address, id, sender, received_at, 'baseline', 'baseline'
from public.emails
where sender_address is not null and sender_address <> ''
order by sender_address, received_at asc, id asc
on conflict (sender_address) do nothing;

update public.emails e
set is_first_sender = true
from public.first_sender_events f
where e.id = f.first_email_id;

alter table public.first_sender_events enable row level security;
