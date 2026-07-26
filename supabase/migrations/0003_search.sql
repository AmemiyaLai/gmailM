alter table public.emails
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('simple', coalesce(subject, '') || ' ' || coalesce(sender, '') || ' ' || coalesce(snippet, ''))
  ) stored;

create index if not exists idx_emails_search on public.emails using gin(search_vector);
