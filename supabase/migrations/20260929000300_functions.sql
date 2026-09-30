-- Business logic that must be atomic: pricing, reserving food, pickup, credit, refunds, payouts and cleanup.
--
-- Errors use custom SQLSTATE codes that the app maps to HTTP-style statuses:
--   BB400 bad input · BB402 payment · BB403 forbidden · BB404 not found · BB409 conflict · BB429 too many attempts
--
-- Functions named restaurant_* / my_* run as the signed-in user (they check auth.uid()).
-- The rest are "service" functions, callable only by the server with the service-role key.

-- ---------------------------------------------------------------- pricing

-- Mirrors src/lib/pricing.ts: round half up at each step.
create function public.price_quote(p_original_unit_cents integer, p_discount_pct integer, p_quantity integer, p_tax_rate_bps integer)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  fee_bps integer := public.setting_int('service_fee_bps');
  unit integer := floor((p_original_unit_cents * (100 - p_discount_pct))::numeric / 100 + 0.5);
  subtotal integer := unit * p_quantity;
  fee integer := floor((subtotal * fee_bps)::numeric / 10000 + 0.5);
  taxable integer := subtotal + case when public.setting_bool('tax_service_fee') then fee else 0 end;
  tax integer := floor((taxable * p_tax_rate_bps)::numeric / 10000 + 0.5);
begin
  return jsonb_build_object(
    'quantity', p_quantity,
    'originalUnitCents', p_original_unit_cents,
    'discountPct', p_discount_pct,
    'unitPriceCents', unit,
    'subtotalCents', subtotal,
    'savingsCents', (p_original_unit_cents - unit) * p_quantity,
    'serviceFeeBps', fee_bps,
    'serviceFeeCents', fee,
    'taxRateBps', p_tax_rate_bps,
    'taxCents', tax,
    'totalCents', subtotal + fee + tax
  );
end;
$$;

-- Validates that an offer can be ordered in this quantity; returns the offer row (locked when p_lock).
create function public._orderable_offer(p_offer_id bigint, p_quantity integer, p_lock boolean)
returns public.offers
language plpgsql security definer set search_path = public as $$
declare
  o public.offers;
  approved boolean;
begin
  if p_lock then
    select * into o from public.offers where id = p_offer_id for update;
  else
    select * into o from public.offers where id = p_offer_id;
  end if;
  select r.status = 'approved' into approved from public.restaurants r where r.id = o.restaurant_id;
  if o.id is null or o.status <> 'active' or o.pickup_end <= now() or not coalesce(approved, false) then
    raise exception 'This offer is no longer available.' using errcode = 'BB404';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 500 then
    raise exception 'Please choose a valid quantity.' using errcode = 'BB400';
  end if;
  if p_quantity > o.quantity_available then
    if o.quantity_available = 0 then
      raise exception 'Sold out.' using errcode = 'BB409';
    end if;
    raise exception 'Only % available. The restaurant set that limit, so you can''t order more.', o.quantity_available using errcode = 'BB409';
  end if;
  return o;
end;
$$;

-- Price of p_quantity of an offer, for the checkout summary.
create function public.quote_offer(p_offer_id bigint, p_quantity integer)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  o public.offers := public._orderable_offer(p_offer_id, p_quantity, false);
  tax_bps integer;
begin
  select tax_rate_bps into tax_bps from public.restaurants where id = o.restaurant_id;
  return public.price_quote(o.original_price_cents, o.discount_pct, p_quantity, tax_bps);
end;
$$;

-- ---------------------------------------------------------------- credit

create function public.credit_balance(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount_cents), 0)::integer from public.credit_ledger where user_id = p_user;
$$;

create function public.my_credit_balance() returns integer
language sql stable security definer set search_path = public as $$
  select public.credit_balance(auth.uid());
$$;

-- Goodwill credit issued by an admin (funded by Rescue Bites).
create function public.issue_credit(p_user uuid, p_amount_cents integer, p_note text, p_by uuid)
returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = p_user and role = 'customer') then
    raise exception 'Customer not found.' using errcode = 'BB404';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 100000 then
    raise exception 'Credit amount must be between $0.01 and $1,000.00.' using errcode = 'BB400';
  end if;
  insert into public.credit_ledger (user_id, amount_cents, kind, note, created_by)
  values (p_user, p_amount_cents, 'goodwill', p_note, p_by);
  return public.credit_balance(p_user);
end;
$$;

-- ---------------------------------------------------------------- orders

-- Random 4-digit PIN from a cryptographic source.
create function public._random_pin() returns text
language sql volatile set search_path = public, extensions as $$
  select lpad(((get_byte(b, 0) * 256 + get_byte(b, 1)) % 10000)::text, 4, '0') from (select gen_random_bytes(2) as b) x;
$$;

-- Step 1 of checkout: reserve the food and create a pending order. The offer row is locked, so two
-- customers can never buy the last item. p_credit_cents of platform credit is set aside now and
-- restored if the order doesn't complete. Cards can't be charged less than $0.50.
create function public.reserve_order(p_user uuid, p_offer_id bigint, p_quantity integer, p_card_label text, p_credit_cents integer default 0)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  o public.offers := public._orderable_offer(p_offer_id, p_quantity, true);
  r public.restaurants;
  q jsonb;
  total integer;
  card integer;
  v_username text;
  v_order public.orders;
  attempts integer := 0;
begin
  select * into r from public.restaurants where id = o.restaurant_id;
  -- Lock the customer so concurrent checkouts can't spend the same credit twice.
  select username into v_username from public.profiles where id = p_user and status = 'active' for update;
  if v_username is null then
    raise exception 'Please log in.' using errcode = 'BB403';
  end if;

  q := public.price_quote(o.original_price_cents, o.discount_pct, p_quantity, r.tax_rate_bps);
  total := (q ->> 'totalCents')::integer;
  p_credit_cents := coalesce(p_credit_cents, 0);
  if p_credit_cents < 0 then
    raise exception 'Invalid credit amount.' using errcode = 'BB400';
  end if;
  if p_credit_cents > total then
    raise exception 'You can apply at most the order total in credit.' using errcode = 'BB400';
  end if;
  if p_credit_cents > public.credit_balance(p_user) then
    raise exception 'You don''t have that much platform credit.' using errcode = 'BB409';
  end if;
  card := total - p_credit_cents;
  if card > 0 and card < 50 then
    raise exception 'The amount left for your card must be at least $0.50. Apply a little more or less credit.' using errcode = 'BB400';
  end if;
  if card > 0 and coalesce(p_card_label, '') = '' then
    raise exception 'Please choose a card for the rest of the total.' using errcode = 'BB400';
  end if;

  update public.offers set quantity_available = quantity_available - p_quantity where id = o.id;

  insert into public.orders (
    user_id, offer_id, restaurant_id, customer_username, item_title, image_url, quantity,
    unit_price_cents, original_unit_price_cents, discount_pct, subtotal_cents, service_fee_cents, service_fee_bps,
    tax_rate_bps, tax_cents, total_cents, status, card_label, pickup_end, credit_applied_cents
  ) values (
    p_user, o.id, o.restaurant_id, v_username, o.title, o.image_url, p_quantity,
    (q ->> 'unitPriceCents')::integer, o.original_price_cents, o.discount_pct, (q ->> 'subtotalCents')::integer,
    (q ->> 'serviceFeeCents')::integer, (q ->> 'serviceFeeBps')::integer,
    r.tax_rate_bps, (q ->> 'taxCents')::integer, total, 'pending_payment',
    case when card > 0 then p_card_label else 'Platform credit' end, o.pickup_end, p_credit_cents
  ) returning * into v_order;

  -- PINs are unique among the restaurant's open orders (enforced by a unique index).
  loop
    attempts := attempts + 1;
    begin
      insert into public.order_pins (order_id, restaurant_id, pin) values (v_order.id, r.id, public._random_pin());
      exit;
    exception when unique_violation then
      if attempts > 200 then
        raise exception 'This restaurant has too many open orders right now.' using errcode = 'BB409';
      end if;
    end;
  end loop;

  if p_credit_cents > 0 then
    insert into public.credit_ledger (user_id, amount_cents, kind, order_id, note)
    values (p_user, -p_credit_cents, 'redeem', v_order.id, 'Applied to order');
  end if;
  return v_order;
end;
$$;

create function public.set_order_payment(p_order_id bigint, p_payment_ref text, p_destination text)
returns void
language sql security definer set search_path = public as $$
  update public.orders set payment_ref = p_payment_ref, destination_account = nullif(p_destination, '') where id = p_order_id;
$$;

-- Payment hold succeeded: the order is now waiting for pickup. Returns false if it wasn't pending.
create function public.mark_order_reserved(p_order_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.orders set status = 'reserved' where id = p_order_id and status = 'pending_payment';
  return found;
end;
$$;

-- Closes an order that is in p_from (cancelled / expired / failed): deactivates the PIN, restores any
-- platform credit, optionally puts the food back on sale, and flags the card hold to be voided.
create function public.release_order(p_order_id bigint, p_from public.order_status, p_to public.order_status, p_restock boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.orders;
begin
  if p_to not in ('cancelled', 'expired', 'failed') then
    raise exception 'Invalid status.' using errcode = 'BB400';
  end if;
  update public.orders
    set status = p_to, closed_at = now(), needs_void = payment_ref is not null, capture_started_at = null
    where id = p_order_id and status = p_from
    returning * into v;
  if not found then
    return jsonb_build_object('changed', false);
  end if;
  update public.order_pins set active = false where order_id = v.id;
  if p_restock then
    update public.offers set quantity_available = least(quantity_total, quantity_available + v.quantity)
      where id = v.offer_id and status <> 'ended' and pickup_end > now();
  end if;
  if v.credit_applied_cents > 0 then
    insert into public.credit_ledger (user_id, amount_cents, kind, order_id, note)
    values (v.user_id, v.credit_applied_cents, 'restore', v.id, format('Order %s: credit returned', p_to));
  end if;
  return jsonb_build_object('changed', true, 'paymentRef', v.payment_ref);
end;
$$;

create function public.clear_void(p_order_id bigint) returns void
language sql security definer set search_path = public as $$
  update public.orders set needs_void = false where id = p_order_id;
$$;

-- Customers cancel their own orders that are awaiting pickup.
create function public.my_cancel_order(p_order_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.orders where id = p_order_id and user_id = auth.uid()) then
    raise exception 'Order not found.' using errcode = 'BB404';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id and status = 'reserved') then
    raise exception 'Only orders awaiting pickup can be cancelled.' using errcode = 'BB409';
  end if;
  return public.release_order(p_order_id, 'reserved', 'cancelled', true);
end;
$$;

-- ---------------------------------------------------------------- pickup

create function public._pickup_json(o public.orders) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', o.id, 'status', o.status, 'itemTitle', o.item_title, 'imageUrl', o.image_url, 'quantity', o.quantity,
    'unitPriceCents', o.unit_price_cents, 'subtotalCents', o.subtotal_cents, 'serviceFeeCents', o.service_fee_cents,
    'taxCents', o.tax_cents, 'totalCents', o.total_cents, 'creditAppliedCents', o.credit_applied_cents,
    'customerUsername', o.customer_username, 'createdAt', o.created_at, 'pickupEnd', o.pickup_end, 'pickedUpAt', o.picked_up_at
  );
$$;

-- The restaurant types the customer's PIN. Failed lookups are counted: 15 wrong PINs in
-- 10 minutes locks lookups for a while. Returns null when no open order matches.
create function public.restaurant_find_pickup(p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rid bigint := public.my_restaurant_id();
  o public.orders;
begin
  if rid is null then
    raise exception 'Restaurant profile not found.' using errcode = 'BB404';
  end if;
  if (select count(*) from public.pin_failures where restaurant_id = rid and at > now() - interval '10 minutes') >= 15 then
    raise exception 'Too many incorrect PINs. Please wait 10 minutes.' using errcode = 'BB429';
  end if;
  if coalesce(p_pin, '') !~ '^\d{4}$' then
    raise exception 'Enter the 4-digit PIN.' using errcode = 'BB400';
  end if;
  select o2.* into o from public.order_pins p join public.orders o2 on o2.id = p.order_id
    where p.restaurant_id = rid and p.pin = p_pin and p.active and o2.status = 'reserved';
  if not found then
    insert into public.pin_failures (restaurant_id) values (rid);
    return null;
  end if;
  return public._pickup_json(o);
end;
$$;

-- Claims an order for capture so it can't be charged twice (a claim expires after 5 minutes).
-- Returns what the server needs to capture the payment.
create function public.restaurant_begin_pickup(p_pin text, p_order_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  found_order jsonb := public.restaurant_find_pickup(p_pin);
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

create function public.abort_pickup(p_order_id bigint) returns void
language sql security definer set search_path = public as $$
  update public.orders set capture_started_at = null where id = p_order_id and status = 'reserved';
$$;

-- Payment captured: the order is complete.
create function public.finish_pickup(p_order_id bigint) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v public.orders;
begin
  update public.orders
    set status = 'picked_up', picked_up_at = now(), closed_at = now(), capture_started_at = null, needs_void = false
    where id = p_order_id and status = 'reserved'
    returning * into v;
  if not found then
    raise exception 'This order is not awaiting pickup.' using errcode = 'BB409';
  end if;
  update public.order_pins set active = false where order_id = p_order_id;
  return v;
end;
$$;

-- ---------------------------------------------------------------- payouts

-- Records money sent to (positive) or taken back from (negative) a restaurant. The invoice number
-- (INV-YYYYMMDD-000001, Pacific date) is assigned here; p_transaction_id defaults to TXN-000001-0001.
create function public.record_payout(
  p_restaurant_id bigint, p_order_id bigint, p_kind public.payout_kind, p_amount_cents integer,
  p_transaction_id text, p_bank_details text, p_note text, p_by uuid
) returns public.payouts
language plpgsql security definer set search_path = public as $$
declare
  v public.payouts;
begin
  insert into public.payouts (restaurant_id, order_id, kind, amount_cents, bank_details, note, created_by)
  values (p_restaurant_id, p_order_id, p_kind, p_amount_cents, coalesce(p_bank_details, ''), coalesce(p_note, ''), p_by)
  returning * into v;
  update public.payouts set
    invoice_number = 'INV-' || to_char(v.paid_at at time zone 'America/Los_Angeles', 'YYYYMMDD') || '-' || lpad(v.id::text, 6, '0'),
    transaction_id = coalesce(nullif(p_transaction_id, ''), 'TXN-' || lpad(v.id::text, 6, '0') || '-' || lpad(p_restaurant_id::text, 4, '0'))
  where id = v.id
  returning * into v;
  return v;
end;
$$;

-- What each restaurant has earned (food subtotal of completed orders, less its share of refunds to the
-- original payment) and what has been paid out. Platform-credit refunds don't reduce earnings.
create view public.restaurant_balances with (security_invoker = true) as
select
  r.id as restaurant_id,
  r.name,
  r.city,
  r.status,
  coalesce(e.orders, 0)::integer as orders,
  coalesce(e.earned, 0)::integer as earned_cents,
  coalesce(p.paid, 0)::integer as paid_cents,
  (coalesce(e.earned, 0) - coalesce(p.paid, 0))::integer as balance_cents,
  p.last_paid_at
from public.restaurants r
left join (
  select o.restaurant_id, count(*) as orders,
    sum(o.subtotal_cents - coalesce((select sum(f.restaurant_share_cents) from public.refunds f where f.order_id = o.id), 0)) as earned
  from public.orders o where o.status = 'picked_up' group by o.restaurant_id
) e on e.restaurant_id = r.id
left join (
  select restaurant_id, sum(amount_cents) as paid, max(paid_at) filter (where amount_cents > 0) as last_paid_at
  from public.payouts group by restaurant_id
) p on p.restaurant_id = r.id;

-- ---------------------------------------------------------------- refunds

-- Records a refund on a completed order after the server has moved the money.
--   p_method 'original': p_card_cents back to the card (already refunded by the server), the rest
--     (p_credit_cents) back to the credit balance the customer paid with. The restaurant gives up
--     p_restaurant_share_cents; Rescue Bites gives up its fee share.
--   p_method 'credit': the whole amount becomes Rescue Bites platform credit, funded by Rescue Bites.
create function public.apply_refund(
  p_order_id bigint, p_amount_cents integer, p_method public.refund_method, p_card_cents integer,
  p_credit_cents integer, p_restaurant_share_cents integer, p_reason text, p_provider_ref text, p_by uuid
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then
    raise exception 'Order not found.' using errcode = 'BB404';
  end if;
  if o.status <> 'picked_up' then
    raise exception 'Only completed (charged) orders can be refunded. Cancel open orders instead.' using errcode = 'BB409';
  end if;
  if p_amount_cents < 1 or p_amount_cents > o.total_cents - o.refunded_cents - o.credited_cents then
    raise exception 'The refund is more than what is left to refund on this order.' using errcode = 'BB409';
  end if;
  if p_card_cents + p_credit_cents <> p_amount_cents then
    raise exception 'Refund parts do not add up.' using errcode = 'BB400';
  end if;
  if p_credit_cents > 0 then
    insert into public.credit_ledger (user_id, amount_cents, kind, order_id, note, created_by)
    values (o.user_id, p_credit_cents, case when p_method = 'credit' then 'refund' else 'restore' end::public.credit_kind, o.id, p_reason, p_by);
  end if;
  update public.orders set
    refunded_cents = refunded_cents + case when p_method = 'original' then p_amount_cents else 0 end,
    card_refunded_cents = card_refunded_cents + p_card_cents,
    credited_cents = credited_cents + case when p_method = 'credit' then p_amount_cents else 0 end,
    refunded_at = now(),
    refund_reason = p_reason
  where id = o.id
  returning * into o;
  insert into public.refunds (order_id, amount_cents, method, card_cents, credit_cents, restaurant_share_cents, reason, provider_ref, created_by)
  values (o.id, p_amount_cents, p_method, p_card_cents, p_credit_cents, p_restaurant_share_cents, p_reason, p_provider_ref, p_by);
  return o;
end;
$$;

-- ---------------------------------------------------------------- restaurant offers

-- Creates (p_offer_id null) or edits an offer from one of the restaurant's menu items.
-- p_expires_in_minutes starts the discard timer now (5 min to 3 days); null keeps the current timer.
create function public.restaurant_save_offer(
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

-- Adds time to a running discard timer ("+30 min").
create function public.restaurant_extend_offer(p_offer_id bigint, p_minutes integer) returns public.offers
language plpgsql security definer set search_path = public as $$
declare
  v public.offers;
  v_end timestamptz;
begin
  select * into v from public.offers where id = p_offer_id and restaurant_id = public.my_restaurant_id() for update;
  if v.id is null then
    raise exception 'Offer not found.' using errcode = 'BB404';
  end if;
  if v.status = 'ended' then
    raise exception 'This offer has already ended. Post it again to restart the timer.' using errcode = 'BB409';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 720 then
    raise exception 'Minutes must be a whole number from 5 to 720.' using errcode = 'BB400';
  end if;
  v_end := greatest(now(), v.pickup_end) + make_interval(mins => p_minutes);
  if v_end > now() + interval '3 days' then
    raise exception 'The timer can be at most 3 days.' using errcode = 'BB400';
  end if;
  update public.offers set pickup_end = v_end where id = v.id returning * into v;
  update public.orders set pickup_end = v_end where offer_id = v.id and status in ('pending_payment', 'reserved');
  return v;
end;
$$;

create function public.restaurant_set_offer_status(p_offer_id bigint, p_status public.offer_status) returns public.offers
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

-- Dashboard numbers for the signed-in restaurant. "Today" is the Pacific-time calendar day.
create function public.restaurant_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  rid bigint := public.my_restaurant_id();
  day_start timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
begin
  if rid is null then
    raise exception 'Restaurant profile not found.' using errcode = 'BB404';
  end if;
  return jsonb_build_object(
    'today', (select jsonb_build_object('orders', count(*), 'meals', coalesce(sum(quantity), 0), 'salesCents', coalesce(sum(subtotal_cents), 0))
              from public.orders where restaurant_id = rid and status = 'picked_up' and picked_up_at >= day_start),
    'allTime', (select jsonb_build_object('orders', count(*), 'meals', coalesce(sum(quantity), 0), 'salesCents', coalesce(sum(subtotal_cents), 0))
                from public.orders where restaurant_id = rid and status = 'picked_up'),
    'awaitingPickup', (select count(*) from public.orders where restaurant_id = rid and status = 'reserved'),
    'activeOffers', (select count(*) from public.offers where restaurant_id = rid and status = 'active' and pickup_end > now())
  );
end;
$$;

-- ---------------------------------------------------------------- search

-- Resolves "98198", "Des Moines" or "Des Moines, WA" to a center point.
create function public.resolve_area(p_query text)
returns table (label text, lat double precision, lng double precision, kind text)
language plpgsql stable set search_path = public, extensions as $$
declare
  q text := lower(btrim(regexp_replace(btrim(coalesce(p_query, '')), ',?\s*(wa|washington)$', '', 'i')));
begin
  if q = '' then
    return;
  end if;
  if q ~ '^\d{5}$' then
    return query
      select z.zip || ' (' || array_to_string(z.cities[1:2], ' / ') || ')', st_y(z.location::geometry), st_x(z.location::geometry), 'zip'
      from public.zips z where z.zip = q;
    return;
  end if;
  -- Primary city names first, then alternate names (e.g. "Federal Way" vs. a neighborhood name).
  return query
    select min(z.city) || ', WA', st_y(st_centroid(st_collect(z.location::geometry))), st_x(st_centroid(st_collect(z.location::geometry))), 'city'
    from public.zips z where lower(z.city) = q
    having count(*) > 0;
  if found then
    return;
  end if;
  return query
    select initcap(q) || ', WA', st_y(st_centroid(st_collect(z.location::geometry))), st_x(st_centroid(st_collect(z.location::geometry))), 'city'
    from public.zips z where exists (select 1 from unnest(z.cities) c where lower(c) = q)
    having count(*) > 0;
end;
$$;

-- Live offers for customers, nearest first when a location is known. Runs with the caller's
-- permissions, so RLS decides what is visible. Distances use PostGIS geography (miles).
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
  distance_miles double precision
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
      then round((st_distance(r.location, origin.g) / 1609.344)::numeric, 1)::double precision end
  from public.offers o
  join public.restaurants r on r.id = o.restaurant_id
  cross join origin
  where o.status = 'active' and o.quantity_available > 0 and o.pickup_end > now() and r.status = 'approved'
    and (coalesce(p_query, '') = '' or (o.title || ' ' || o.description || ' ' || r.name || ' ' || r.cuisine) ilike '%' || p_query || '%')
    and (coalesce(p_area_text, '') = '' or r.city ilike '%' || p_area_text || '%' or r.zip like p_area_text || '%')
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

-- ---------------------------------------------------------------- cleanup

-- Runs every minute (pg_cron, and the /api/cron/sweep route, which also voids card holds):
--   * checkouts stuck in pending_payment for 15 minutes are released and restocked;
--   * orders not picked up 10 minutes after the discard timer ends are released without charge;
--   * offers whose timer has run out are ended.
create function public.sweep() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x record;
  failed integer := 0;
  expired integer := 0;
  ended integer := 0;
begin
  for x in select id from public.orders where status = 'pending_payment' and created_at < now() - interval '15 minutes' loop
    perform public.release_order(x.id, 'pending_payment', 'failed', true);
    failed := failed + 1;
  end loop;
  for x in select id from public.orders where status = 'reserved' and pickup_end < now() - interval '10 minutes'
             and (capture_started_at is null or capture_started_at < now() - interval '5 minutes') loop
    perform public.release_order(x.id, 'reserved', 'expired', false);
    expired := expired + 1;
  end loop;
  update public.offers set status = 'ended' where status <> 'ended' and pickup_end < now();
  get diagnostics ended = row_count;
  delete from public.pin_failures where at < now() - interval '1 day';
  return jsonb_build_object('failed', failed, 'expired', expired, 'ended', ended);
end;
$$;

-- ---------------------------------------------------------------- privileges

-- Service functions: server only (service_role).
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public._orderable_offer(bigint, integer, boolean)',
    'public._random_pin()',
    'public.credit_balance(uuid)',
    'public.issue_credit(uuid, integer, text, uuid)',
    'public.reserve_order(uuid, bigint, integer, text, integer)',
    'public.set_order_payment(bigint, text, text)',
    'public.mark_order_reserved(bigint)',
    'public.release_order(bigint, public.order_status, public.order_status, boolean)',
    'public.clear_void(bigint)',
    'public.abort_pickup(bigint)',
    'public.finish_pickup(bigint)',
    'public.record_payout(bigint, bigint, public.payout_kind, integer, text, text, text, uuid)',
    'public.apply_refund(bigint, integer, public.refund_method, integer, integer, integer, text, text, uuid)',
    'public.sweep()',
    'public.setting_int(text)',
    'public.setting_bool(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

-- Signed-in only.
revoke execute on function public.my_credit_balance() from public, anon;
revoke execute on function public.my_cancel_order(bigint) from public, anon;
revoke execute on function public.restaurant_find_pickup(text) from public, anon;
revoke execute on function public.restaurant_begin_pickup(text, bigint) from public, anon;
revoke execute on function public.restaurant_save_offer(bigint, bigint, public.offer_reason, text, integer, integer, integer) from public, anon;
revoke execute on function public.restaurant_extend_offer(bigint, integer) from public, anon;
revoke execute on function public.restaurant_set_offer_status(bigint, public.offer_status) from public, anon;
revoke execute on function public.restaurant_stats() from public, anon;
revoke execute on function public.accept_terms(jsonb, text, text) from public, anon;
revoke execute on function public.pending_terms() from public, anon;

grant select on public.restaurant_balances to authenticated;
