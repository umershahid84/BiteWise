-- Timed suspensions and account deletion (owner console → Users).
-- A suspension lasts a set number of days: suspended_until records when it ends, and the every-minute
-- sweep reactivates the account then (Supabase Auth lifts its login ban at the same time).
-- Deleted accounts that have order history keep their orders for sales and tax records, but the
-- person's name and email are removed and the status becomes 'deleted'.
alter type public.account_status add value if not exists 'deleted';
alter table public.profiles add column suspended_until timestamptz;

-- As in 20260929000300_functions.sql, plus reactivating accounts whose suspension has ended.
create or replace function public.sweep() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x record;
  failed integer := 0;
  expired integer := 0;
  ended integer := 0;
  reactivated integer := 0;
begin
  for x in select id from public.orders where status = 'pending_payment' and created_at < now() - interval '15 minutes' loop
    perform public.release_order(x.id, 'pending_payment', 'failed', true);
    failed := failed + 1;
  end loop;
  for x in select id from public.orders where status = 'reserved' and pickup_end < now() - interval '10 minutes'
             and (capture_started_at is null or capture_started_at < now() - interval '5 minutes') loop
    perform public.release_order(x.id, 'reserved', 'expired', false);
    expired := expired + 1;
  end loop;
  update public.offers set status = 'ended' where status <> 'ended' and pickup_end < now();
  get diagnostics ended = row_count;
  delete from public.pin_failures where at < now() - interval '1 day';
  update public.profiles set status = 'active', suspended_until = null
    where status = 'suspended' and suspended_until <= now();
  get diagnostics reactivated = row_count;
  return jsonb_build_object('failed', failed, 'expired', expired, 'ended', ended, 'reactivated', reactivated);
end;
$$;
