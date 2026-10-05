-- Restaurant kiosks and onboarding emails.
--
-- Each restaurant gets a kiosk: a full-screen page for the counter tablet at /kiosk/<token>, where staff see
-- orders awaiting pickup and hand them over with the customer's PIN. The secret token in the link is the
-- kiosk's only credential, so it lives in its own table that only the owner (and the server) can read.
-- restaurant_onboarding records which onboarding emails the server has sent (application pending, welcome).

create table public.restaurant_kiosks (
  restaurant_id bigint primary key references public.restaurants (id) on delete cascade,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{24,64}$'),
  created_at timestamptz not null default now()
);
alter table public.restaurant_kiosks enable row level security;
create policy "owners read their kiosk link" on public.restaurant_kiosks for select to authenticated
  using (restaurant_id = public.my_restaurant_id());

create table public.restaurant_onboarding (
  restaurant_id bigint primary key references public.restaurants (id) on delete cascade,
  pending_email_sent_at timestamptz,
  welcome_email_sent_at timestamptz
);
alter table public.restaurant_onboarding enable row level security; -- server only: no policies

-- PIN lookups for a given restaurant. The owner's functions below pass their own restaurant; the kiosk's
-- server actions pass the restaurant of a verified kiosk token. Same rules: 15 wrong PINs in 10 minutes
-- lock lookups for that restaurant.
create function public.find_pickup_for(p_restaurant_id bigint, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if p_restaurant_id is null then
    raise exception 'Restaurant profile not found.' using errcode = 'BB404';
  end if;
  if (select count(*) from public.pin_failures where restaurant_id = p_restaurant_id and at > now() - interval '10 minutes') >= 15 then
    raise exception 'Too many incorrect PINs. Please wait 10 minutes.' using errcode = 'BB429';
  end if;
  if coalesce(p_pin, '') !~ '^\d{4}$' then
    raise exception 'Enter the 4-digit PIN.' using errcode = 'BB400';
  end if;
  select o2.* into o from public.order_pins p join public.orders o2 on o2.id = p.order_id
    where p.restaurant_id = p_restaurant_id and p.pin = p_pin and p.active and o2.status = 'reserved';
  if not found then
    insert into public.pin_failures (restaurant_id) values (p_restaurant_id);
    return null;
  end if;
  return public._pickup_json(o);
end;
$$;

create function public.begin_pickup_for(p_restaurant_id bigint, p_pin text, p_order_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  found_order jsonb := public.find_pickup_for(p_restaurant_id, p_pin);
  v public.orders;
begin
  if found_order is null then
    raise exception 'No order awaiting pickup matches that PIN.' using errcode = 'BB404';
  end if;
  if (found_order ->> 'id')::bigint <> p_order_id then
    raise exception 'PIN does not match this order.' using errcode = 'BB409';
  end if;
  update public.orders set capture_started_at = now()
    where id = p_order_id and status = 'reserved'
      and (capture_started_at is null or capture_started_at < now() - interval '5 minutes')
    returning * into v;
  if not found then
    raise exception 'This order is already being processed.' using errcode = 'BB409';
  end if;
  return public._pickup_json(v) || jsonb_build_object('paymentRef', v.payment_ref, 'destinationAccount', v.destination_account);
end;
$$;

revoke execute on function public.find_pickup_for(bigint, text) from public, anon, authenticated;
revoke execute on function public.begin_pickup_for(bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.find_pickup_for(bigint, text) to service_role;
grant execute on function public.begin_pickup_for(bigint, text, bigint) to service_role;

-- The owner's dashboard versions now share that code.
create or replace function public.restaurant_find_pickup(p_pin text) returns jsonb
language sql security definer set search_path = public as $$
  select public.find_pickup_for(public.my_restaurant_id(), p_pin);
$$;

create or replace function public.restaurant_begin_pickup(p_pin text, p_order_id bigint) returns jsonb
language sql security definer set search_path = public as $$
  select public.begin_pickup_for(public.my_restaurant_id(), p_pin, p_order_id);
$$;
