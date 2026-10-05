-- Delinquent plans. A declined subscription payment now makes the plan delinquent at once (status past_due): the
-- restaurant can't post or turn on offers, and its live offers are paused, until a payment succeeds. There is no
-- grace period any more, and a delinquent plan never lapses by itself: it stays delinquent until it is paid.
-- Restaurants keep cards on file (payment_methods, like customers); auto-renewal charges their default card.

-- As in 20261006000200_bans_and_subscriptions.sql, but a delinquent plan is never OK, and an auto-renewing plan
-- only keeps working for one day after its period ends while the renewal is being charged.
create or replace function public.restaurant_plan_ok(p_restaurant_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.restaurant_subscriptions s
    where s.restaurant_id = p_restaurant_id
      and (s.plan = 'founding'
        or (s.status = 'active' and s.current_period_end + case when s.auto_renew then interval '1 day' else interval '0' end > now()))
  );
$$;

-- As in 20261006000200_bans_and_subscriptions.sql. Only plans that were set not to renew lapse; a delinquent plan
-- (past_due) stays delinquent until it is paid, and an auto-renewing one waits for the renewal charge.
create or replace function public.sweep() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x record;
  failed integer := 0;
  expired integer := 0;
  ended integer := 0;
  reactivated integer := 0;
  reinstated integer := 0;
  lapsed integer := 0;
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
  update public.restaurants set status = 'approved', suspended_until = null
    where status = 'suspended' and suspended_until <= now();
  get diagnostics reinstated = row_count;

  update public.restaurant_subscriptions set status = 'expired', updated_at = now()
    where plan <> 'founding' and status = 'active' and not auto_renew and current_period_end <= now();
  get diagnostics lapsed = row_count;
  update public.offers o set status = 'paused'
    where o.status = 'active'
      and exists (select 1 from public.restaurants r where r.id = o.restaurant_id and r.status = 'approved')
      and not public.restaurant_plan_ok(o.restaurant_id);

  return jsonb_build_object('failed', failed, 'expired', expired, 'ended', ended, 'reactivated', reactivated,
    'reinstated', reinstated, 'lapsed', lapsed);
end;
$$;

-- As in 20261006000200_bans_and_subscriptions.sql, with the delinquent message.
create or replace function public._restaurant_posting_block(rid bigint) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  r public.restaurants;
  s public.restaurant_subscriptions;
begin
  select * into r from public.restaurants where id = rid;
  if r.status = 'banned' then
    return 'Your restaurant has been removed from Bite Wise, so you cannot post offers.';
  elsif r.status = 'suspended' then
    return 'Your restaurant is suspended' || coalesce(' until ' || to_char(r.suspended_until at time zone 'America/Los_Angeles', 'FMMonth FMDD'), '')
      || ', so you cannot post offers. Please contact Bite Wise support.';
  elsif r.status = 'approved' and not public.restaurant_plan_ok(rid) then
    select * into s from public.restaurant_subscriptions where restaurant_id = rid;
    if s.status = 'past_due' then
      return 'Your Bite Wise plan is delinquent because a payment was declined. Pay it in the Plan tab of your dashboard to post offers again.';
    end if;
    return 'Choose a Bite Wise plan to post offers: open the Plan tab of your dashboard.';
  end if;
  return null;
end;
$$;
revoke execute on function public._restaurant_posting_block(bigint) from public, anon, authenticated;

-- The restaurant agreement now says declined payments make the plan delinquent at once.
update public.legal_documents set version = '2026-10-07.1';
