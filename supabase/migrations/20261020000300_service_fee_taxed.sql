-- The customer service fee is Bite Wise's platform fee, and it is taxed at the rate of Bite Wise's location in the
-- restaurant's country: Washington for orders in the United States, Newfoundland and Labrador HST for orders in
-- Canada (settings platform_tax_rate_bps_us / _ca, the same rates as on plan fees). The food is taxed at the
-- restaurant's own rate (restaurants.tax_rate_bps), as before. An order's tax_cents is the food's tax plus the fee's;
-- the fee's part is what order_fee_tax() finds (tax_cents minus the food's tax), so refunds, kept fees and the
-- restaurant's share keep working unchanged.

drop function public.price_quote(integer, integer, integer, integer);

create function public.platform_tax_bps(p_country text) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(public.setting_int(case when p_country = 'CA' then 'platform_tax_rate_bps_ca' else 'platform_tax_rate_bps_us' end),
                  case when p_country = 'CA' then 1500 else 1035 end);
$$;

-- Mirrors src/lib/pricing.ts: round half up at each step.
create function public.price_quote(p_original_unit_cents integer, p_discount_pct integer, p_quantity integer, p_tax_rate_bps integer, p_country text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  fixed boolean := coalesce((select value #>> '{}' from public.settings where key = 'service_fee_mode'), 'percent') = 'fixed';
  fee_bps integer := case when fixed then 0 else public.setting_int('service_fee_bps') end;
  unit integer := floor((p_original_unit_cents * (100 - p_discount_pct))::numeric / 100 + 0.5);
  subtotal integer := unit * p_quantity;
  fee integer := case when fixed then coalesce(public.setting_int('service_fee_fixed_cents'), 0)
                      else floor((subtotal * fee_bps)::numeric / 10000 + 0.5)::integer end;
  fee_tax_bps integer := public.platform_tax_bps(p_country);
  food_tax integer := floor((subtotal * p_tax_rate_bps)::numeric / 10000 + 0.5);
  fee_tax integer := floor((fee * fee_tax_bps)::numeric / 10000 + 0.5);
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
    'foodTaxCents', food_tax,
    'serviceFeeTaxBps', fee_tax_bps,
    'serviceFeeTaxCents', fee_tax,
    'taxCents', food_tax + fee_tax,
    'totalCents', subtotal + fee + food_tax + fee_tax
  );
end;
$$;
revoke execute on function public.price_quote(integer, integer, integer, integer, text) from public, anon, authenticated;
revoke execute on function public.platform_tax_bps(text) from public, anon, authenticated;

create or replace function public.quote_offer(p_offer_id bigint, p_quantity integer)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  o public.offers := public._orderable_offer(p_offer_id, p_quantity, false);
  r public.restaurants;
begin
  select * into r from public.restaurants where id = o.restaurant_id;
  return public.price_quote(o.original_price_cents, o.discount_pct, p_quantity, r.tax_rate_bps, r.country);
end;
$$;


create or replace function public.reserve_order(p_user uuid, p_offer_id bigint, p_quantity integer, p_card_label text, p_credit_cents integer default 0)
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

  q := public.price_quote(o.original_price_cents, o.discount_pct, p_quantity, r.tax_rate_bps, r.country);
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


-- The Customer Terms now say how the service fee is taxed.
update public.legal_documents set version = '2026-10-20.2';
grant execute on function public.price_quote(integer, integer, integer, integer, text) to service_role;
grant execute on function public.platform_tax_bps(text) to service_role;
