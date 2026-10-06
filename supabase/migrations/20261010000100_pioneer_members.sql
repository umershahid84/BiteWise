-- Pioneer Members (formerly "Founding Partners"). The first restaurants to choose a plan (setting founding_spots, 50)
-- get it free: they pick monthly or annual like everyone else, no card is asked for, and every period they get an
-- invoice that shows the plan price, the Pioneer Members Discount and a total of $0.00. Restaurants can choose a plan
-- as soon as their email is confirmed, while they wait for approval.
--
-- A Pioneer membership is a monthly or annual plan with a pioneer number (founding_number) and price 0. The old
-- 'founding' plan value is no longer used; existing founding plans become free monthly Pioneer memberships.

-- Invoices: a $0.00 invoice is allowed, and an invoice can show the list price and a discount.
alter table public.subscription_payments drop constraint if exists subscription_payments_amount_cents_check;
alter table public.subscription_payments add constraint subscription_payments_amount_cents_check check (amount_cents >= 0);
alter table public.subscription_payments
  add column list_price_cents integer check (list_price_cents >= 0),
  add column discount_cents integer not null default 0 check (discount_cents >= 0),
  add column discount_label text not null default '';

update public.restaurant_subscriptions
set plan = 'monthly', status = 'active', auto_renew = true, price_cents = 0,
    current_period_start = now(), current_period_end = now() + interval '1 month', updated_at = now()
where plan = 'founding' and founding_number is not null;

-- As in 20261007000100_delinquent_plans.sql, plus active Pioneer memberships (free, so never delinquent).
create or replace function public.restaurant_plan_ok(p_restaurant_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.restaurant_subscriptions s
    where s.restaurant_id = p_restaurant_id
      and (s.plan = 'founding'
        or (s.founding_number is not null and s.status = 'active')
        or (s.status = 'active' and s.current_period_end + case when s.auto_renew then interval '1 day' else interval '0' end > now()))
  );
$$;

-- Makes the restaurant a Pioneer Member on the plan it chose, if a spot is left (setting founding_spots) and it has no
-- current plan. Returns its pioneer number, or null when no spot is left (it then pays for its plan).
create or replace function public.claim_pioneer_spot(p_restaurant_id bigint, p_plan public.subscription_plan) returns integer
language plpgsql security definer set search_path = public as $$
declare
  spots integer := coalesce((select (value #>> '{}')::integer from public.settings where key = 'founding_spots'), 50);
  existing public.restaurant_subscriptions;
  taken integer;
  n integer;
begin
  if p_plan not in ('monthly', 'annual') then
    raise exception 'Choose the monthly or annual plan.' using errcode = 'BB400';
  end if;
  perform pg_advisory_xact_lock(hashtext('bitewise_founding_spots'));
  select * into existing from public.restaurant_subscriptions where restaurant_id = p_restaurant_id;
  if existing.restaurant_id is not null and existing.status <> 'expired' then
    return existing.founding_number;
  end if;
  select count(*) into taken from public.restaurant_subscriptions where founding_number is not null;
  if taken >= spots then
    return null;
  end if;
  select coalesce(max(founding_number), 0) + 1 into n from public.restaurant_subscriptions;
  insert into public.restaurant_subscriptions (restaurant_id, plan, renew_plan, status, founding_number, auto_renew, price_cents,
    current_period_start, current_period_end, locked_monthly_cents, locked_annual_cents, last_payment_error, retry_at, renewing_at, reminder_sent_for)
  values (p_restaurant_id, p_plan, null, 'active', n, true, 0,
    now(), now() + case when p_plan = 'annual' then interval '1 year' else interval '1 month' end, null, null, '', null, null, null)
  on conflict (restaurant_id) do update set plan = excluded.plan, renew_plan = null, status = 'active', founding_number = excluded.founding_number,
    auto_renew = true, price_cents = 0, current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
    locked_monthly_cents = null, locked_annual_cents = null, last_payment_error = '', retry_at = null, renewing_at = null, reminder_sent_for = null,
    updated_at = now();
  return n;
end;
$$;
revoke execute on function public.claim_pioneer_spot(bigint, public.subscription_plan) from public, anon, authenticated;
grant execute on function public.claim_pioneer_spot(bigint, public.subscription_plan) to service_role;

-- Spots are now claimed when a plan is chosen, not when a restaurant is approved.
drop function if exists public.claim_founding_spot(bigint);

-- The restaurant agreement now describes Pioneer Members.
update public.legal_documents set version = '2026-10-10.1';
