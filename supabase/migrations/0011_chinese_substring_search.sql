create extension if not exists pg_trgm;

alter table public.emails
  add column if not exists search_text text
  generated always as (
    coalesce(sender, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(snippet, '')
  ) stored;

create index if not exists idx_emails_search_text_trgm
  on public.emails using gin (search_text gin_trgm_ops);
