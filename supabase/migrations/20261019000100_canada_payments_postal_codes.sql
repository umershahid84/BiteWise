-- Payments in Canadian dollars, and customers' ZIP or postal code.
--
-- Each country has its own Stripe account (src/lib/payments): orders at Canadian restaurants are charged in CAD by
-- the Canadian account, and Canadian restaurants are paid out through it. Orders, plan payments and payouts record
-- their currency (from the restaurant's country) so the books are kept per currency. Saved cards and Stripe
-- customers belong to one account, so they record their country too.
--
-- Customers give their ZIP code (US) or postal code (Canada) instead of a city; its map position is where the deals
-- page starts (src/app/offers/page.tsx).

-- ---------------------------------------------------------------- currency on money records

alter table public.orders add column currency text not null default 'usd' check (currency in ('usd', 'cad'));
alter table public.subscription_payments add column currency text not null default 'usd' check (currency in ('usd', 'cad'));
alter table public.payouts add column currency text not null default 'usd' check (currency in ('usd', 'cad'));

-- The currency of the restaurant's country, set when the row is written.
create function public.currency_from_restaurant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select case when r.country = 'CA' then 'cad' else 'usd' end into new.currency from public.restaurants r where r.id = new.restaurant_id;
  new.currency := coalesce(new.currency, 'usd');
  return new;
end;
$$;
create trigger orders_currency before insert on public.orders for each row execute function public.currency_from_restaurant();
create trigger subscription_payments_currency before insert on public.subscription_payments for each row execute function public.currency_from_restaurant();
create trigger payouts_currency before insert on public.payouts for each row execute function public.currency_from_restaurant();
revoke execute on function public.currency_from_restaurant() from public, anon, authenticated;

-- ---------------------------------------------------------------- cards and Stripe customers per country

alter table public.payment_methods add column country text not null default 'US' check (country in ('US', 'CA'));
alter table public.profiles add column stripe_customer_id_ca text;

-- ---------------------------------------------------------------- customers' ZIP / postal code

alter table public.profiles
  add column postal_code text not null default '' check (char_length(postal_code) <= 10),
  -- Where that ZIP or postal code is (its center), looked up when it is saved; null if it couldn't be found.
  add column home_lat double precision check (home_lat between -90 and 90),
  add column home_lng double precision check (home_lng between -180 and 180);

-- ---------------------------------------------------------------- offer search: the restaurant's country

drop function public.search_offers(double precision, double precision, double precision, text, text, text, text);
create function public.search_offers(
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_miles double precision default null,
  p_query text default null,
  p_area_text text default null,
  p_dietary text default null,
  p_sort text default null
) returns table (
  id bigint, title text, description text, reason public.offer_reason, dietary text[], image_url text,
  original_price_cents integer, price_cents integer, discount_pct integer, quantity_available integer, quantity_total integer,
  pickup_start timestamptz, pickup_end timestamptz, restaurant_id bigint, restaurant_name text, cuisine text,
  address text, city text, zip text, phone text, lat double precision, lng double precision, tax_rate_bps integer,
  distance_miles double precision, country text
)
language sql stable security invoker set search_path = public, extensions as $$
  with origin as (
    select case when p_lat is not null and p_lng is not null
      then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end as g
  )
  select o.id, o.title, o.description, o.reason, o.dietary, o.image_url,
    o.original_price_cents, o.price_cents, o.discount_pct, o.quantity_available, o.quantity_total,
    o.pickup_start, o.pickup_end, r.id, r.name, r.cuisine, r.address, r.city, r.zip, r.phone, r.lat, r.lng, r.tax_rate_bps,
    case when origin.g is not null and r.location is not null
      then round((st_distance(r.location, origin.g) / 1609.344)::numeric, 1)::double precision end,
    r.country
  from public.offers o
  join public.restaurants r on r.id = o.restaurant_id
  cross join origin
  where o.status = 'active' and o.quantity_available > 0 and o.pickup_end > now() and r.status = 'approved'
    and (coalesce(p_query, '') = '' or (o.title || ' ' || o.description || ' ' || r.name || ' ' || r.cuisine) ilike '%' || p_query || '%')
    and (coalesce(p_area_text, '') = '' or r.city ilike '%' || p_area_text || '%' or replace(r.zip, ' ', '') ilike replace(p_area_text, ' ', '') || '%')
    and (coalesce(p_dietary, '') = '' or p_dietary = any (o.dietary))
    and (origin.g is null or coalesce(p_radius_miles, 0) <= 0 or r.location is null
      or st_dwithin(r.location, origin.g, p_radius_miles * 1609.344))
  order by
    case when coalesce(p_sort, case when origin.g is not null then 'distance' else 'ending' end) = 'distance'
      then st_distance(r.location, origin.g) end asc nulls last,
    case when p_sort = 'discount' then o.discount_pct end desc,
    case when p_sort = 'price' then o.price_cents end asc,
    o.pickup_end asc
  limit 300;
$$;

-- The terms now say orders are in the restaurant's currency and Platform Credit is used in the customer's country.
update public.legal_documents set version = '2026-10-19.1';
