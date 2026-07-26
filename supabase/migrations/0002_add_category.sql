alter table public.emails add column if not exists category varchar(32);

create index if not exists idx_emails_category on public.emails(category);
