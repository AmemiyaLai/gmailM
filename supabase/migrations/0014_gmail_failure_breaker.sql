-- 連續錯誤熔斷器
--
-- 0013 的 cooldown 只在 Gmail 明確回 429 時觸發。但實務上更常見的是「持續失敗但不是 429」：
-- Pub/Sub 對 5xx 會不斷重送，每次重送都完整跑一輪 Gmail + Supabase 查詢，錯誤流量可以連續空轉
-- 數小時。這裡記錄連續失敗的起點與次數，一旦失敗持續超過設定的時間窗就強制進入長冷卻，
-- 並回報是否該發 Discord 警告（同一段故障只通知一次，避免通知本身變成另一種風暴）。

alter table public.gmail_sync_state
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists first_failure_at timestamptz,
  add column if not exists breaker_notified_at timestamptz;

create or replace function public.record_gmail_failure(
  p_watch_address text,
  p_error text,
  p_window_seconds integer default 300,
  p_min_failures integer default 3,
  p_cooldown_seconds integer default 3600
)
returns table(
  consecutive_failures integer,
  first_failure_at timestamptz,
  tripped boolean,
  should_notify boolean,
  cooldown_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  state public.gmail_sync_state%rowtype;
  v_first timestamptz;
  v_count integer;
  v_tripped boolean := false;
  v_notify boolean := false;
  v_cooldown timestamptz;
begin
  insert into public.gmail_sync_state (watch_address, updated_at)
  values (p_watch_address, now())
  on conflict (watch_address) do nothing;

  select * into state
  from public.gmail_sync_state
  where watch_address = p_watch_address
  for update;

  v_first := coalesce(state.first_failure_at, now());
  v_count := coalesce(state.consecutive_failures, 0) + 1;

  -- 必須同時滿足「持續夠久」與「失敗夠多次」：只看時間會讓兩次相隔很久的偶發錯誤誤觸，
  -- 只看次數則擋不住慢速但持續的重送。
  if now() - v_first >= make_interval(secs => greatest(60, p_window_seconds))
     and v_count >= greatest(2, p_min_failures) then
    v_tripped := true;
    v_cooldown := now() + make_interval(secs => greatest(300, p_cooldown_seconds));
    -- 同一段故障（first_failure_at 未被重設）只通知一次
    v_notify := state.breaker_notified_at is null or state.breaker_notified_at < v_first;
  end if;

  update public.gmail_sync_state
  set consecutive_failures = v_count,
      first_failure_at = v_first,
      last_sync_error = left(coalesce(p_error, ''), 500),
      cooldown_until = coalesce(v_cooldown, state.cooldown_until),
      breaker_notified_at = case when v_notify then now() else state.breaker_notified_at end,
      -- 熔斷時一併釋放 lease，否則要等 processing_until 自然到期才可能恢復
      processing_token = case when v_tripped then null else state.processing_token end,
      processing_until = case when v_tripped then null else state.processing_until end,
      updated_at = now()
  where watch_address = p_watch_address;

  return query select v_count, v_first, v_tripped, v_notify, v_cooldown;
end;
$$;

revoke all on function public.record_gmail_failure(text, text, integer, integer, integer) from public;
grant execute on function public.record_gmail_failure(text, text, integer, integer, integer) to service_role;
