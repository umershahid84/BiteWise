-- Automatic sales tax rates.
-- Every order is picked up at the restaurant, so the sale happens at the restaurant's address, and that address
-- decides the sales tax rate (state + county + city + special districts). Plan fees are paid by the restaurant at the
-- same address. The app looks the rate up from the address (src/lib/tax) instead of the restaurant typing it in; an
-- admin can still set a rate by hand.

alter table public.restaurants
  add column state text not null default 'WA' check (state ~ '^[A-Z]{2}$'),
  -- 'auto': looked up from the address and refreshed regularly. 'manual': set by an admin, never changed by the app.
  add column tax_source text not null default 'auto' check (tax_source in ('auto', 'manual')),
  -- Where the rate came from, e.g. "Seattle, WA (WA Department of Revenue)" or "WA state rate only (estimate)".
  add column tax_jurisdiction text not null default '',
  -- How sure we are: 'address' (rooftop-level rate for the street address), 'zip' (ZIP code area) or 'state'
  -- (state rate only: local taxes missing, check it).
  add column tax_accuracy text not null default '' check (tax_accuracy in ('', 'address', 'zip', 'state', 'manual')),
  add column tax_checked_at timestamptz,
  add column tax_lookup_error text not null default '';

-- Existing restaurants are looked up by the next scheduled run (tax_checked_at is null).

-- Restaurants can no longer set their own tax rate; the state is part of their address.
revoke update (tax_rate_bps) on public.restaurants from authenticated;
grant update (state) on public.restaurants to authenticated;

-- A new restaurant's state comes from the sign-up form (auth metadata), next to its address.
create function public.restaurant_state_from_signup() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_state text;
begin
  select upper(btrim(u.raw_user_meta_data -> 'restaurant' ->> 'state')) into v_state from auth.users u where u.id = new.owner_id;
  if v_state ~ '^[A-Z]{2}$' then
    new.state := v_state;
  end if;
  return new;
end;
$$;

create trigger restaurants_state_from_signup
  before insert on public.restaurants
  for each row execute function public.restaurant_state_from_signup();

-- Receipts and the admin tax report show where the tax was charged.
alter table public.orders add column tax_jurisdiction text not null default '';
alter table public.subscription_payments add column tax_jurisdiction text not null default '';

create function public.order_tax_jurisdiction() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tax_jurisdiction = '' then
    select r.tax_jurisdiction into new.tax_jurisdiction from public.restaurants r where r.id = new.restaurant_id;
    new.tax_jurisdiction := coalesce(new.tax_jurisdiction, '');
  end if;
  return new;
end;
$$;

create trigger orders_tax_jurisdiction
  before insert on public.orders
  for each row execute function public.order_tax_jurisdiction();

-- States where plan fees (Bite Wise's subscription, a software service) are taxed. Taxability of software services
-- differs by state: add a state once Bite Wise is registered there and your accountant confirms it.
insert into public.settings (key, value) values ('plan_tax_states', '"WA"') on conflict (key) do nothing;

-- Legal documents: sales tax at the rate for the restaurant's address (src/lib/legal/documents.ts).
update public.legal_documents set version = '2026-10-12.1';
