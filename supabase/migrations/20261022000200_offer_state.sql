-- The deals search also returns the restaurant's state or province, so its address shows correctly everywhere
-- ("St. John's, NL", not a fixed "WA") and the Map link finds it.
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
  distance_miles double precision, country text, state text
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
    r.country, r.state
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
