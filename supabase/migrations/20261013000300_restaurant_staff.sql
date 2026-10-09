-- Restaurant staff: managers and supervisors the owner gives their own user name and password, so they can post
-- surplus food, manage the menu (add items, change prices) and hand over orders when the owner isn't there. Staff
-- can't see the restaurant's payouts, plan and billing, sales reports, kiosk link or profile (sales tax).
-- The 'staff' role is added in 20261013000100_staff_role.sql.

create table public.restaurant_staff (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  restaurant_id bigint not null references public.restaurants (id) on delete cascade,
  full_name text not null default '',
  title text not null default 'Manager' check (title in ('Manager', 'Supervisor')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index restaurant_staff_restaurant_idx on public.restaurant_staff (restaurant_id);
alter table public.restaurant_staff enable row level security;

-- The restaurant the signed-in user works for: their own (owner) or their employer's (active staff of a restaurant
-- that isn't banned or deleted). Everything restaurant staff may do goes through this function.
create or replace function public.my_restaurant_id() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.restaurants where owner_id = auth.uid()),
    (select s.restaurant_id from public.restaurant_staff s
       join public.profiles p on p.id = s.user_id and p.role = 'staff' and p.status = 'active'
       join public.restaurants r on r.id = s.restaurant_id and r.status not in ('banned', 'deleted')
     where s.user_id = auth.uid())
  );
$$;

-- Only the owner's restaurant: money, billing, payouts and the kiosk link.
create function public.my_owned_restaurant_id() returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.restaurants where owner_id = auth.uid();
$$;
revoke execute on function public.my_owned_restaurant_id() from public, anon;
grant execute on function public.my_owned_restaurant_id() to authenticated, service_role;

create policy "owners and staff read staff" on public.restaurant_staff for select to authenticated
  using (restaurant_id = (select public.my_owned_restaurant_id()) or user_id = (select auth.uid()) or (select public.is_admin()));

-- Staff can read their restaurant (also while it waits for approval).
drop policy "read restaurants" on public.restaurants;
create policy "read restaurants" on public.restaurants for select
  using (
    status = 'approved'
    or owner_id = (select auth.uid())
    or id = (select public.my_restaurant_id())
    or (select public.is_admin())
    or exists (select 1 from public.orders o where o.restaurant_id = restaurants.id and o.user_id = (select auth.uid()))
  );

-- Owner only (not staff).
drop policy "owners and admins read payment accounts" on public.restaurant_payment_accounts;
create policy "owners and admins read payment accounts" on public.restaurant_payment_accounts for select to authenticated
  using (restaurant_id = (select public.my_owned_restaurant_id()) or (select public.is_admin()));
drop policy "read payouts" on public.payouts;
create policy "read payouts" on public.payouts for select to authenticated
  using (restaurant_id = (select public.my_owned_restaurant_id()) or (select public.is_admin()));
drop policy "owners read their kiosk link" on public.restaurant_kiosks;
create policy "owners read their kiosk link" on public.restaurant_kiosks for select to authenticated
  using (restaurant_id = (select public.my_owned_restaurant_id()));
drop policy "owners and admins read subscriptions" on public.restaurant_subscriptions;
create policy "owners and admins read subscriptions" on public.restaurant_subscriptions for select to authenticated
  using (restaurant_id = (select public.my_owned_restaurant_id()) or (select public.is_admin()));
drop policy "owners and admins read subscription payments" on public.subscription_payments;
create policy "owners and admins read subscription payments" on public.subscription_payments for select to authenticated
  using (restaurant_id = (select public.my_owned_restaurant_id()) or (select public.is_admin()));

-- One-time invites the server writes just before creating a staff account (service role only: no policies).
create table public.staff_invites (
  token text primary key check (token ~ '^[0-9a-f]{64}$'),
  restaurant_id bigint not null references public.restaurants (id) on delete cascade,
  full_name text not null default '',
  title text not null default 'Manager' check (title in ('Manager', 'Supervisor')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.staff_invites enable row level security;

-- Sign-up trigger: staff accounts (made by the server) skip the customer/restaurant sign-up checks.
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
  v_restaurant bigint;
  v_loc geography;
  doc record;
  -- Staff are created only by the server for a restaurant owner (src/lib/staff.ts): it first stores a one-time
  -- invite with a random token, which the new user's metadata carries. Nobody else can know a valid token. Staff
  -- accept no terms of their own: they work under their restaurant's agreement.
  v_invite public.staff_invites;
begin
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
    insert into public.profiles (id, email, username, role) values (new.id, new.email, v_username, 'staff');
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

  for doc in select * from public.legal_documents d where v_role = any (d.roles) loop
    if accepted ->> doc.id is distinct from doc.version then
      raise exception 'To create an account you must accept the %.', doc.title using errcode = '22023';
    end if;
  end loop;

  insert into public.profiles (id, email, username, role) values (new.id, new.email, v_username, v_role);

  insert into public.terms_acceptances (user_id, document, version, ip, user_agent)
  select new.id, d.id, d.version, left(coalesce(meta ->> 'ip', ''), 64), left(coalesce(meta ->> 'user_agent', ''), 300)
  from public.legal_documents d where v_role = any (d.roles);

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
