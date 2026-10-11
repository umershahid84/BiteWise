-- The United States and Canada. Everyone has a country (US or CA) and, for customers, a state or province and city;
-- restaurants have a country next to their state or province. The country decides which legal documents a person
-- accepts: the US set (customer-terms, restaurant-agreement, privacy) or the Canadian set (the "-ca" documents), see
-- src/lib/legal/documents.ts. Existing accounts are in the United States.

alter table public.profiles
  add column country text not null default 'US' check (country in ('US', 'CA')),
  add column region text not null default '' check (region = '' or region ~ '^[A-Z]{2}$'),
  add column city text not null default '' check (char_length(city) <= 60);

alter table public.restaurants
  add column country text not null default 'US' check (country in ('US', 'CA'));
-- ZIP codes (12345 or 12345-6789) and Canadian postal codes (A1A 1A1).
alter table public.restaurants drop constraint if exists restaurants_zip_check;
alter table public.restaurants add constraint restaurants_zip_check
  check (zip ~ '^\d{5}(-\d{4})?$' or zip ~ '^[A-Z]\d[A-Z] \d[A-Z]\d$');
-- Restaurant owners can correct their country together with their address.
grant update (country) on public.restaurants to authenticated;

alter table public.legal_documents add column country text not null default 'US' check (country in ('US', 'CA'));
insert into public.legal_documents (id, title, version, roles, country) values
  ('customer-terms-ca', 'Customer Terms of Service (Canada)', '2026-10-18.1', '{customer}', 'CA'),
  ('restaurant-agreement-ca', 'Restaurant Partner Agreement (Canada)', '2026-10-18.1', '{restaurant}', 'CA'),
  ('privacy-ca', 'Privacy Policy (Canada)', '2026-10-18.1', '{customer,restaurant}', 'CA')
on conflict (id) do nothing;
-- The US documents are now written for the whole United States (no longer Washington State only).
update public.legal_documents set version = '2026-10-18.1';

-- Documents the signed-in user still has to accept: those of their role and country.
create or replace function public.pending_terms() returns setof public.legal_documents
language sql stable security definer set search_path = public as $$
  select d.* from public.legal_documents d
  join public.profiles p on p.id = auth.uid() and p.role = any (d.roles) and p.country = d.country
  where not exists (
    select 1 from public.terms_acceptances t
    where t.user_id = p.id and t.document = d.id and t.version = d.version
  );
$$;

-- A new restaurant's state or province and country come from the sign-up form (auth metadata), with its address.
create or replace function public.restaurant_state_from_signup() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb;
begin
  select u.raw_user_meta_data into meta from auth.users u where u.id = new.owner_id;
  if upper(btrim(meta -> 'restaurant' ->> 'state')) ~ '^[A-Z]{2}$' then
    new.state := upper(btrim(meta -> 'restaurant' ->> 'state'));
  end if;
  if upper(coalesce(meta -> 'restaurant' ->> 'country', meta ->> 'country', '')) in ('US', 'CA') then
    new.country := upper(coalesce(meta -> 'restaurant' ->> 'country', meta ->> 'country'));
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  accepted jsonb := coalesce(meta -> 'accepted_terms', '{}'::jsonb);
  r jsonb := coalesce(meta -> 'restaurant', '{}'::jsonb);
  v_role public.user_role;
  v_username text := btrim(coalesce(meta ->> 'username', ''));
  v_country text := upper(coalesce(nullif(btrim(meta ->> 'country'), ''), 'US'));
  v_region text := upper(btrim(coalesce(meta ->> 'region', '')));
  v_city text := left(btrim(coalesce(meta ->> 'city', '')), 60);
  v_restaurant bigint;
  v_loc geography;
  doc record;
  -- Staff are created only by the server for a restaurant owner (src/lib/staff.ts): it first stores a one-time
  -- invite with a random token, which the new user's metadata carries. Nobody else can know a valid token. Staff
  -- accept no terms of their own: they work under their restaurant's agreement.
  v_invite public.staff_invites;
  v_team public.team_invites;
begin
  if v_country not in ('US', 'CA') then
    raise exception 'Choose United States or Canada.' using errcode = '22023';
  end if;
  if v_region !~ '^([A-Z]{2})?$' then
    v_region := '';
  end if;

  -- Admins and admin employees are created only by a full admin in the owner console (src/lib/team.ts), through a
  -- one-time invite like restaurant staff.
  if meta ? 'team_invite' then
    delete from public.team_invites
    where token = meta ->> 'team_invite' and created_at > now() - interval '10 minutes'
    returning * into v_team;
    if v_team.token is null then
      raise exception 'This invitation is not valid.' using errcode = '22023';
    end if;
    if v_username !~ '^[A-Za-z0-9_.]{3,24}$' then
      raise exception 'User name must be 3-24 characters: letters, numbers, dots or underscores.' using errcode = '22023';
    end if;
    insert into public.profiles (id, email, username, role, can_refund)
    values (new.id, new.email, v_username, v_team.role, v_team.role = 'admin' or v_team.can_refund);
    return new;
  end if;

  if meta ? 'staff_invite' then
    delete from public.staff_invites
    where token = meta ->> 'staff_invite' and created_at > now() - interval '10 minutes'
    returning * into v_invite;
    if v_invite.token is null then
      raise exception 'This staff invitation is not valid.' using errcode = '22023';
    end if;
    if v_username !~ '^[A-Za-z0-9_.]{3,24}$' then
      raise exception 'User name must be 3-24 characters: letters, numbers, dots or underscores.' using errcode = '22023';
    end if;
    insert into public.profiles (id, email, username, role, country)
    select new.id, new.email, v_username, 'staff', r2.country from public.restaurants r2 where r2.id = v_invite.restaurant_id;
    insert into public.restaurant_staff (user_id, restaurant_id, full_name, title, created_by)
    values (new.id, v_invite.restaurant_id, v_invite.full_name, v_invite.title, v_invite.created_by);
    return new;
  end if;

  if meta ->> 'role' = 'restaurant' then
    v_role := 'restaurant';
  else
    v_role := 'customer';
  end if;

  if v_username !~ '^[A-Za-z0-9_.]{3,24}$' then
    raise exception 'User name must be 3-24 characters: letters, numbers, dots or underscores.' using errcode = '22023';
  end if;

  -- The documents of the person's role and country, at their current versions.
  for doc in select * from public.legal_documents d where v_role = any (d.roles) and d.country = v_country loop
    if accepted ->> doc.id is distinct from doc.version then
      raise exception 'To create an account you must accept the %.', doc.title using errcode = '22023';
    end if;
  end loop;

  insert into public.profiles (id, email, username, role, country, region, city)
  values (new.id, new.email, v_username, v_role, v_country, v_region, v_city);

  insert into public.terms_acceptances (user_id, document, version, ip, user_agent)
  select new.id, d.id, d.version, left(coalesce(meta ->> 'ip', ''), 64), left(coalesce(meta ->> 'user_agent', ''), 300)
  from public.legal_documents d where v_role = any (d.roles) and d.country = v_country;

  if v_role = 'restaurant' then
    -- Exact pin if given, otherwise the ZIP code's center until the owner drags the pin in the portal.
    if (r ->> 'lat') ~ '^-?\d+(\.\d+)?$' and (r ->> 'lng') ~ '^-?\d+(\.\d+)?$' then
      v_loc := st_setsrid(st_makepoint((r ->> 'lng')::double precision, (r ->> 'lat')::double precision), 4326)::geography;
    else
      v_loc := public.zip_location(r ->> 'zip');
    end if;
    insert into public.restaurants (owner_id, name, address, city, zip, phone, cuisine, location, tax_rate_bps, status)
    values (
      new.id, btrim(r ->> 'name'), btrim(r ->> 'address'), btrim(r ->> 'city'), btrim(r ->> 'zip'),
      btrim(coalesce(r ->> 'phone', '')), btrim(coalesce(r ->> 'cuisine', '')), v_loc,
      public.setting_int('default_tax_rate_bps'),
      case when public.setting_bool('require_restaurant_approval') then 'pending' else 'approved' end::public.restaurant_status
    )
    returning id into v_restaurant;
    insert into public.restaurant_payment_accounts (restaurant_id) values (v_restaurant);
  end if;

  return new;
end;
$function$;
