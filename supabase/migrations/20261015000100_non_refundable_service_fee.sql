-- The Bite Wise service fee is not refundable.
--   * Missed pickups and orders the customer cancels: the card hold is captured for the service fee only (plus any
--     sales tax charged on the fee) instead of being released; the rest of the hold is let go. If Platform Credit
--     paid part of the order, the fee is taken from the card first and then from that credit.
--     Orders the restaurant or Bite Wise cancels, and failed payments, are still released in full.
--   * Refunds on completed orders can return at most the food and its sales tax, never the service fee.

alter table public.orders
  add column kept_fee_cents integer not null default 0 check (kept_fee_cents >= 0),
  add column kept_tax_cents integer not null default 0 check (kept_tax_cents >= 0),
  add column kept_card_cents integer not null default 0 check (kept_card_cents >= 0),
  add column needs_fee_charge boolean not null default false,
  add column fee_charge_ref text;

-- The part of an order that is never refunded: the service fee and the sales tax charged on it (when the fee is taxed).
create function public.order_fee_tax(o public.orders) returns integer
language sql immutable as $$
  select greatest(0, o.tax_cents - floor((o.subtotal_cents * o.tax_rate_bps)::numeric / 10000 + 0.5)::integer);
$$;
create function public.order_non_refundable(o public.orders) returns integer
language sql immutable as $$
  select o.service_fee_cents + public.order_fee_tax(o);
$$;

-- p_keep_fee: keep the service fee instead of releasing everything. Missed pickups (to 'expired') keep it by default.
drop function public.release_order(bigint, public.order_status, public.order_status, boolean);
create function public.release_order(p_order_id bigint, p_from public.order_status, p_to public.order_status, p_restock boolean, p_keep_fee boolean default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.orders;
  keep boolean := coalesce(p_keep_fee, p_to = 'expired');
  fee integer;
  fee_tax integer;
  card integer;
  card_part integer := 0;
  credit_kept integer := 0;
begin
  if p_to not in ('cancelled', 'expired', 'failed') then
    raise exception 'Invalid status.' using errcode = 'BB400';
  end if;
  select * into v from public.orders where id = p_order_id and status = p_from for update;
  if not found then
    return jsonb_build_object('changed', false);
  end if;
  if keep and p_from = 'reserved' then
    fee := v.service_fee_cents;
    fee_tax := public.order_fee_tax(v);
    card := case when v.payment_ref is null then 0 else v.total_cents - v.credit_applied_cents end;
    card_part := least(fee + fee_tax, card);
    credit_kept := least(fee + fee_tax - card_part, v.credit_applied_cents);
  else
    fee := 0;
    fee_tax := 0;
  end if;
  update public.orders
    set status = p_to, closed_at = now(), capture_started_at = null,
        kept_fee_cents = least(fee, card_part + credit_kept),
        kept_tax_cents = greatest(0, card_part + credit_kept - least(fee, card_part + credit_kept)),
        kept_card_cents = card_part,
        needs_fee_charge = card_part > 0,
        needs_void = payment_ref is not null and card_part = 0
    where id = v.id
    returning * into v;
  update public.order_pins set active = false where order_id = v.id;
  if p_restock then
    update public.offers set quantity_available = least(quantity_total, quantity_available + v.quantity)
      where id = v.offer_id and status <> 'ended' and pickup_end > now();
  end if;
  if v.credit_applied_cents - credit_kept > 0 then
    insert into public.credit_ledger (user_id, amount_cents, kind, order_id, note)
    values (v.user_id, v.credit_applied_cents - credit_kept, 'restore', v.id,
      case when credit_kept > 0 then format('Order %s: credit returned (less the non-refundable service fee)', p_to)
           else format('Order %s: credit returned', p_to) end);
  end if;
  return jsonb_build_object('changed', true, 'paymentRef', v.payment_ref, 'keptCents', v.kept_fee_cents + v.kept_tax_cents);
end;
$$;

-- Customers cancelling an order keep paying the service fee.
create or replace function public.my_cancel_order(p_order_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.orders where id = p_order_id and user_id = auth.uid()) then
    raise exception 'Order not found.' using errcode = 'BB404';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id and status = 'reserved') then
    raise exception 'Only orders awaiting pickup can be cancelled.' using errcode = 'BB409';
  end if;
  return public.release_order(p_order_id, 'reserved', 'cancelled', true, true);
end;
$$;

-- After the service fee was charged to the card (ref), or when the card couldn't be charged (ref null: Bite Wise
-- gives up the card part of the fee).
create function public.finish_fee_charge(p_order_id bigint, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_ref is null then
    update public.orders set
      kept_fee_cents = (kept_fee_cents + kept_tax_cents - kept_card_cents) - least(kept_tax_cents, kept_fee_cents + kept_tax_cents - kept_card_cents),
      kept_tax_cents = least(kept_tax_cents, kept_fee_cents + kept_tax_cents - kept_card_cents),
      kept_card_cents = 0, needs_fee_charge = false
    where id = p_order_id and needs_fee_charge;
  else
    update public.orders set fee_charge_ref = p_ref, needs_fee_charge = false where id = p_order_id and needs_fee_charge;
  end if;
end;
$$;

-- Refunds never include the service fee.
create or replace function public.apply_refund(
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
  if p_amount_cents < 1 or p_amount_cents > o.total_cents - public.order_non_refundable(o) - o.refunded_cents - o.credited_cents then
    raise exception 'The refund is more than what is left to refund on this order (the service fee is not refundable).' using errcode = 'BB409';
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

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.release_order(bigint, public.order_status, public.order_status, boolean, boolean)',
    'public.finish_fee_charge(bigint, text)',
    'public.apply_refund(bigint, integer, public.refund_method, integer, integer, integer, text, text, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
revoke execute on function public.my_cancel_order(bigint) from public, anon;

-- Legal documents: the service fee and subscription fees are not refundable (src/lib/legal/documents.ts).
update public.legal_documents set version = '2026-10-15.1';
