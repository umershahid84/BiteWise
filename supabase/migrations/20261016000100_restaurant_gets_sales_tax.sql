-- Who keeps the sales tax on the food. Setting order_tax_to_restaurant (default true): the restaurant is paid the food
-- price plus the sales tax on it and reports and remits that tax itself; Bite Wise keeps only the service fee (and any
-- tax on the fee). Set it to false when Bite Wise must collect and remit as a marketplace facilitator: then the
-- restaurant gets the food price only and Bite Wise keeps the tax to remit it.
--
-- orders.restaurant_share_cents is fixed when the order is placed, so a later change of the setting never changes
-- what an existing order pays out. Orders from before this migration keep the old rule (food price only).

insert into public.settings (key, value) values ('order_tax_to_restaurant', 'true') on conflict (key) do nothing;

alter table public.orders add column restaurant_share_cents integer;
update public.orders set restaurant_share_cents = subtotal_cents;
alter table public.orders alter column restaurant_share_cents set not null;
alter table public.orders alter column restaurant_share_cents set default 0; -- set by the trigger below
alter table public.orders add constraint orders_restaurant_share_check check (restaurant_share_cents between 0 and total_cents);

-- The restaurant's share of a new order: the food price, plus the sales tax on the food when the setting says so.
create function public.set_restaurant_share() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.restaurant_share_cents := new.subtotal_cents + case when public.setting_bool('order_tax_to_restaurant')
    then least(new.tax_cents, floor((new.subtotal_cents * new.tax_rate_bps)::numeric / 10000 + 0.5)::integer) else 0 end;
  return new;
end;
$$;
create trigger orders_restaurant_share before insert on public.orders for each row execute function public.set_restaurant_share();
revoke execute on function public.set_restaurant_share() from public, anon, authenticated;

-- What each restaurant has earned: its share of every completed order, less what refunds took back.
create or replace view public.restaurant_balances with (security_invoker = true) as
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
    sum(o.restaurant_share_cents - coalesce((select sum(f.restaurant_share_cents) from public.refunds f where f.order_id = o.id), 0)) as earned
  from public.orders o where o.status = 'picked_up' group by o.restaurant_id
) e on e.restaurant_id = r.id
left join (
  select restaurant_id, sum(amount_cents) as paid, max(paid_at) filter (where amount_cents > 0) as last_paid_at
  from public.payouts group by restaurant_id
) p on p.restaurant_id = r.id;
grant select on public.restaurant_balances to authenticated;

-- Legal documents: who remits sales tax on orders (src/lib/legal/documents.ts).
update public.legal_documents set version = '2026-10-16.1';
