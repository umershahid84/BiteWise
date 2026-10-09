-- The admin team: more admins (full access) and admin employees (role 'support', added in
-- 20261014000100_support_role.sql). Employees see Alerts, Restaurants, Customers, Orders and Live offers, and can
-- update accounts, approve, suspend, ban and reactivate, and resend emails. Only those an admin allows can issue
-- refunds and credit (can_refund). Permissions are checked by the server (src/lib/auth.ts requireAdmin).

alter table public.profiles add column can_refund boolean not null default false;
update public.profiles set can_refund = true where role = 'admin';

-- One-time invites a full admin writes just before creating a team account (service role only: no policies).
create table public.team_invites (
  token text primary key check (token ~ '^[0-9a-f]{64}$'),
  role public.user_role not null check (role in ('admin', 'support')),
  can_refund boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.team_invites enable row level security;

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
  v_team public.team_invites;
begin
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
