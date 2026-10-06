-- 1. Missed pickups (no-shows). An order that is reserved and not picked up before its discard timer runs out is
--    released as 'expired' and the food goes to waste. The platform counts a customer's consecutive no-shows (a pickup
--    resets the count):
--      * 3 in a row (setting no_show_limit): the account is suspended for 30 days (setting no_show_suspension_days),
--        automatically; the sweep reactivates it when the time is up.
--      * After that suspension, the first no-show bans the account permanently, automatically.
--    Every no-show, suspension and ban is recorded in admin_alerts; the app then blocks the login, cancels open orders
--    and emails the customer and the admins (src/lib/no-shows.ts).
-- 2. Washington sales tax on restaurant plan fees, at the restaurant's location rate.

alter table public.profiles
  add column no_show_strikes integer not null default 0 check (no_show_strikes >= 0),
  add column no_shows_total integer not null default 0 check (no_shows_total >= 0),
  -- Set when the account was suspended for no-shows: from then on, one more no-show bans it.
  add column no_show_probation boolean not null default false;

create type public.admin_alert_kind as enum ('no_show', 'no_show_suspension', 'no_show_ban');

create table public.admin_alerts (
  id bigint generated always as identity primary key,
  kind public.admin_alert_kind not null,
  user_id uuid references public.profiles (id) on delete cascade,
  order_id bigint references public.orders (id) on delete set null,
  -- The customer's consecutive no-shows when this happened.
  strikes integer not null default 0,
  message text not null default '',
  created_at timestamptz not null default now(),
  -- When the app finished acting on it (login blocked, open orders cancelled, emails sent).
  processed_at timestamptz,
  read_at timestamptz,
  read_by uuid references public.profiles (id) on delete set null
);
create index admin_alerts_unprocessed_idx on public.admin_alerts (id) where processed_at is null;
create index admin_alerts_user_idx on public.admin_alerts (user_id);
alter table public.admin_alerts enable row level security;
create policy admin_alerts_admin_read on public.admin_alerts for select to authenticated using (public.is_admin());

insert into public.settings (key, value) values ('no_show_limit', '3'), ('no_show_suspension_days', '30')
on conflict (key) do nothing;

create or replace function public.track_pickup_outcome() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
  lim integer := coalesce((select (value #>> '{}')::integer from public.settings where key = 'no_show_limit'), 3);
  days integer := coalesce((select (value #>> '{}')::integer from public.settings where key = 'no_show_suspension_days'), 30);
  strikes integer;
begin
  if new.status = 'picked_up' and old.status <> 'picked_up' then
    update public.profiles set no_show_strikes = 0 where id = new.user_id and no_show_strikes <> 0;
    return new;
  end if;
  if not (new.status = 'expired' and old.status = 'reserved') then
    return new;
  end if;

  select * into p from public.profiles where id = new.user_id for update;
  if p.id is null or p.role <> 'customer' or p.status in ('banned', 'deleted') then
    return new;
  end if;
  strikes := p.no_show_strikes + 1;
  update public.profiles set no_show_strikes = strikes, no_shows_total = no_shows_total + 1 where id = p.id;

  if p.no_show_probation and p.status = 'active' then
    -- Already suspended once for no-shows: banned for good.
    update public.profiles set status = 'banned', suspended_until = null where id = p.id;
    insert into public.admin_alerts (kind, user_id, order_id, strikes, message)
    values ('no_show_ban', p.id, new.id, strikes,
      format('%s missed another pickup (order #%s) after a no-show suspension and was banned permanently.', p.username, new.id));
  elsif not p.no_show_probation and strikes >= lim then
    update public.profiles
    set status = 'suspended', suspended_until = greatest(coalesce(suspended_until, now()), now() + make_interval(days => days)),
        no_show_probation = true, no_show_strikes = 0
    where id = p.id;
    insert into public.admin_alerts (kind, user_id, order_id, strikes, message)
    values ('no_show_suspension', p.id, new.id, strikes,
      format('%s missed %s pickups in a row (last: order #%s) and was suspended for %s days.', p.username, strikes, new.id, days));
  else
    insert into public.admin_alerts (kind, user_id, order_id, strikes, message)
    values ('no_show', p.id, new.id, strikes,
      format('%s did not pick up order #%s (%s in a row).', p.username, new.id, strikes));
  end if;
  return new;
end;
$$;

create trigger orders_pickup_outcome after update of status on public.orders
  for each row when (new.status is distinct from old.status) execute function public.track_pickup_outcome();

-- Sales tax on plan fees. amount_cents stays the total charged; list_price_cents - discount_cents is the taxable amount.
alter table public.subscription_payments
  add column tax_rate_bps integer not null default 0 check (tax_rate_bps between 0 and 2000),
  add column tax_cents integer not null default 0 check (tax_cents >= 0);

-- The customer terms (no-shows) and the restaurant agreement (sales tax on plans) changed.
update public.legal_documents set version = '2026-10-11.1';
