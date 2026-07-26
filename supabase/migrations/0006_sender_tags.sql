create table if not exists public.sender_tags (
  sender_key varchar(254) primary key,
  tag varchar(32) not null check (tag in ('banking', 'securities', 'commerce', 'development', 'media', 'learning', 'travel', 'security', 'other')),
  source varchar(16) not null check (source in ('auto', 'manual')),
  confidence numeric(3,2),
  was_aggregated boolean not null default false,
  sender_display varchar(255) not null,
  updated_at timestamptz not null default current_timestamp
);

create index if not exists idx_sender_tags_tag on public.sender_tags(tag);
alter table public.sender_tags enable row level security;
