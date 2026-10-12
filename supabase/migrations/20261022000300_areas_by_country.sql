-- The deal search's "City or ZIP / postal code" box used only the Washington ZIP list. Suggestions now come from
-- where restaurants actually are, in the customer's country, and any of those cities or codes can be searched.

-- Cities and codes that have an approved restaurant in the country ('US' or 'CA').
create function public.area_suggestions(p_country text)
returns table (value text, hint text, kind text)
language sql stable security definer set search_path = public as $$
  select * from (
    select distinct r.city || coalesce(', ' || nullif(r.state, ''), ''), coalesce(nullif(r.state, ''), r.country), 'city'
    from public.restaurants r
    where r.status = 'approved' and r.country = upper(p_country) and coalesce(r.city, '') <> ''
    union
    select distinct r.zip, r.city, 'zip'
    from public.restaurants r
    where r.status = 'approved' and r.country = upper(p_country) and coalesce(r.zip, '') <> ''
  ) s(value, hint, kind)
  order by kind, value
  limit 500;
$$;
grant execute on function public.area_suggestions(text) to anon, authenticated;

-- Resolves "98198", "A1H 0G5", "A1H", "Des Moines", "St. John's" or "St. John's, NL" to a center point: the
-- Washington ZIP list first, then the restaurants on Bite Wise anywhere in the US or Canada.
create or replace function public.resolve_area(p_query text)
returns table (label text, lat double precision, lng double precision, kind text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  raw text := btrim(coalesce(p_query, ''));
  region text := upper(nullif(btrim(substring(raw from ',\s*([A-Za-z .]+)$')), ''));
  q text := lower(btrim(regexp_replace(raw, ',\s*[A-Za-z .]+$', '')));
  code text := upper(replace(raw, ' ', ''));
begin
  if raw = '' then
    return;
  end if;
  if region in ('WASHINGTON') then region := 'WA'; end if;

  if q ~ '^\d{5}$' then
    return query
      select z.zip || ' (' || array_to_string(z.cities[1:2], ' / ') || ')', st_y(z.location::geometry), st_x(z.location::geometry), 'zip'
      from public.zips z where z.zip = q;
    if found then return; end if;
    return query
      select q || ' (' || min(r.city) || ')', avg(r.lat), avg(r.lng), 'zip'
      from public.restaurants r
      where r.status = 'approved' and r.country = 'US' and left(r.zip, 5) = q and r.lat is not null
      having count(*) > 0;
    return;
  end if;

  -- Canadian postal code, or just its first three characters (the area).
  if code ~ '^[A-Z]\d[A-Z](\d[A-Z]\d)?$' then
    return query
      select (case when length(code) = 6 then left(code, 3) || ' ' || right(code, 3) else code end) || ' (' || min(r.city) || ')',
        avg(r.lat), avg(r.lng), 'zip'
      from public.restaurants r
      where r.status = 'approved' and r.country = 'CA' and r.lat is not null
        and upper(replace(r.zip, ' ', '')) like code || '%'
      having count(*) > 0;
    return;
  end if;

  -- Primary city names first, then alternate names (e.g. "Federal Way" vs. a neighborhood name).
  if region is null or region = 'WA' then
    return query
      select min(z.city) || ', WA', st_y(st_centroid(st_collect(z.location::geometry))), st_x(st_centroid(st_collect(z.location::geometry))), 'city'
      from public.zips z where lower(z.city) = q
      having count(*) > 0;
    if found then return; end if;
    return query
      select initcap(q) || ', WA', st_y(st_centroid(st_collect(z.location::geometry))), st_x(st_centroid(st_collect(z.location::geometry))), 'city'
      from public.zips z where exists (select 1 from unnest(z.cities) c where lower(c) = q)
      having count(*) > 0;
    if found then return; end if;
  end if;

  -- A city with restaurants on Bite Wise, anywhere (narrowed by state or province when one is given).
  return query
    select min(r.city) || coalesce(', ' || min(nullif(r.state, '')), ''), avg(r.lat), avg(r.lng), 'city'
    from public.restaurants r
    where r.status = 'approved' and r.lat is not null and lower(r.city) = q
      and (region is null or upper(r.state) = region)
    group by r.country, r.state
    order by count(*) desc
    limit 1;
end;
$$;
