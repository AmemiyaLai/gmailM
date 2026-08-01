alter table public.gmail_sync_state
  add column if not exists cooldown_until timestamptz,
  add column if not exists processing_until timestamptz,
  add column if not exists processing_token uuid;

create or replace function public.acquire_gmail_sync_lease(
  p_watch_address text,
  p_processing_token uuid,
  p_notification_history_id bigint default null,
  p_lease_seconds integer default 120
)
returns table(status text, last_history_id bigint, retry_after timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  state public.gmail_sync_state%rowtype;
  inserted_rows integer := 0;
begin
  insert into public.gmail_sync_state (watch_address, last_history_id, updated_at)
  values (p_watch_address, p_notification_history_id, now())
  on conflict (watch_address) do nothing;
  get diagnostics inserted_rows = row_count;

  select * into state
  from public.gmail_sync_state
  where watch_address = p_watch_address
  for update;

  if inserted_rows > 0 and p_notification_history_id is not null then
    return query select 'baseline'::text, state.last_history_id, null::timestamptz;
    return;
  end if;
  if state.cooldown_until is not null and state.cooldown_until > now() then
    return query select 'cooldown'::text, state.last_history_id, state.cooldown_until;
    return;
  end if;
  if p_notification_history_id is not null
     and state.last_history_id is not null
     and p_notification_history_id <= state.last_history_id then
    return query select 'duplicate'::text, state.last_history_id, null::timestamptz;
    return;
  end if;
  if state.processing_until is not null and state.processing_until > now() then
    return query select 'busy'::text, state.last_history_id, state.processing_until;
    return;
  end if;

  update public.gmail_sync_state
  set processing_token = p_processing_token,
      processing_until = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 600))),
      updated_at = now()
  where watch_address = p_watch_address;
  return query select 'acquired'::text, state.last_history_id, null::timestamptz;
end;
$$;

revoke all on function public.acquire_gmail_sync_lease(text, uuid, bigint, integer) from public;
grant execute on function public.acquire_gmail_sync_lease(text, uuid, bigint, integer) to service_role;
