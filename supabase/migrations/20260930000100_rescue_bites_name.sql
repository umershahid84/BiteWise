-- The business is now called Rescue Bites: the suspended-restaurant message names it, and the
-- every-minute cleanup job is renamed. The functions are as in 20260929000300_functions.sql; only that message changed.

-- Creates (p_offer_id null) or edits an offer from one of the restaurant's menu items.
-- p_expires_in_minutes starts the discard timer now (5 min to 3 days); null keeps the current timer.
create or replace function public.restaurant_save_offer(
  p_offer_id bigint, p_menu_item_id bigint, p_reason public.offer_reason, p_description text,
  p_discount_pct integer, p_quantity integer, p_expires_in_minutes integer
) returns public.offers
language plpgsql security definer set search_path = public as $$
declare
  rid bigint := public.my_restaurant_id();
  r_status public.restaurant_status;
  item public.menu_items;
  existing public.offers;
  v public.offers;
  v_start timestamptz;
  v_end timestamptz;
  committed integer := 0;
  v_description text;
begin
  if rid is null then
    raise exception 'Restaurant profile not found.' using errcode = 'BB404';
  end if;
  select status into r_status from public.restaurants where id = rid;
  if p_offer_id is not null then
    select * into existing from public.offers where id = p_offer_id and restaurant_id = rid for update;
    if existing.id is null then
      raise exception 'Offer not found.' using errcode = 'BB404';
    end if;
    if existing.status = 'ended' then
      raise exception 'Ended offers cannot be edited.' using errcode = 'BB409';
    end if;
    committed := existing.quantity_total - existing.quantity_available;
  elsif r_status = 'suspended' then
    raise exception 'Your restaurant is suspended, so you cannot post offers. Please contact Rescue Bites support.' using errcode = 'BB403';
  end if;

  select * into item from public.menu_items where id = p_menu_item_id and restaurant_id = rid and active;
  if item.id is null then
    raise exception 'Menu item not found.' using errcode = 'BB404';
  end if;
  if p_reason is null then
    raise exception 'Please choose why this food is available.' using errcode = 'BB400';
  end if;
  if p_discount_pct is null or p_discount_pct < 1 or p_discount_pct > 90 then
    raise exception 'Discount must be a whole number from 1 to 90.' using errcode = 'BB400';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 500 then
    raise exception 'Quantity must be a whole number from 1 to 500.' using errcode = 'BB400';
  end if;
  if p_quantity < committed then
    raise exception '% already ordered, so quantity cannot be lower than that.', committed using errcode = 'BB400';
  end if;
  if char_length(coalesce(p_description, '')) > 500 then
    raise exception 'Description must be at most 500 characters.' using errcode = 'BB400';
  end if;

  if p_expires_in_minutes is not null then
    if p_expires_in_minutes < 5 or p_expires_in_minutes > 4320 then
      raise exception 'Discard timer (minutes) must be a whole number from 5 to 4320.' using errcode = 'BB400';
    end if;
    v_start := case when existing.id is not null and existing.pickup_start < now() then existing.pickup_start else now() end;
    v_end := now() + make_interval(mins => p_expires_in_minutes);
  elsif existing.id is not null then
    v_start := existing.pickup_start;
    v_end := existing.pickup_end;
  else
    raise exception 'Please set the discard timer.' using errcode = 'BB400';
  end if;

  v_description := coalesce(nullif(btrim(p_description), ''), item.description);

  if existing.id is null then
    insert into public.offers (restaurant_id, menu_item_id, image_url, title, description, reason, dietary,
      original_price_cents, discount_pct, quantity_total, quantity_available, pickup_start, pickup_end)
    values (rid, item.id, item.image_url, item.name, v_description, p_reason, item.dietary,
      item.price_cents, p_discount_pct, p_quantity, p_quantity, v_start, v_end)
    returning * into v;
  else
    -- Price changes only affect new orders; existing orders keep the price they were quoted.
    update public.offers set menu_item_id = item.id, image_url = item.image_url, title = item.name,
      description = v_description, reason = p_reason, dietary = item.dietary, original_price_cents = item.price_cents,
      discount_pct = p_discount_pct, quantity_total = p_quantity, quantity_available = p_quantity - committed,
      pickup_start = v_start, pickup_end = v_end
    where id = existing.id
    returning * into v;
    update public.orders set pickup_end = v_end where offer_id = v.id and status in ('pending_payment', 'reserved');
  end if;
  return v;
end;
$$;


create or replace function public.restaurant_set_offer_status(p_offer_id bigint, p_status public.offer_status) returns public.offers
language plpgsql security definer set search_path = public as $$
declare
  v public.offers;
  r_status public.restaurant_status;
begin
  select * into v from public.offers where id = p_offer_id and restaurant_id = public.my_restaurant_id() for update;
  if v.id is null then
    raise exception 'Offer not found.' using errcode = 'BB404';
  end if;
  if v.status = 'ended' then
    raise exception 'This offer has already ended.' using errcode = 'BB409';
  end if;
  if p_status = 'active' then
    if v.pickup_end <= now() then
      raise exception 'The pickup window has passed. Create a new offer.' using errcode = 'BB400';
    end if;
    select status into r_status from public.restaurants where id = v.restaurant_id;
    if r_status = 'suspended' then
      raise exception 'Your restaurant is suspended, so you cannot post offers. Please contact Rescue Bites support.' using errcode = 'BB403';
    end if;
  end if;
  update public.offers set status = p_status where id = v.id returning * into v;
  return v;
end;
$$;

-- Databases set up before the rename have the cleanup job as biteback-sweep.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'biteback-sweep';
    perform cron.schedule('rescuebites-sweep', '* * * * *', 'select public.sweep()');
  end if;
exception when others then
  raise notice 'Could not rename the cleanup job (%); schedule /api/cron/sweep instead.', sqlerrm;
end;
$$;
