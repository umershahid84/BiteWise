-- The customer service fee is either a percentage of the food subtotal (service_fee_bps) or a fixed amount per order
-- (service_fee_fixed_cents, in the order's currency), whichever the admin chose (service_fee_mode: percent | fixed).
-- Orders with a fixed fee record service_fee_bps = 0.

insert into public.settings (key, value) values
  ('service_fee_mode', '"percent"'),
  ('service_fee_fixed_cents', '99')
on conflict (key) do nothing;

-- Mirrors src/lib/pricing.ts: round half up at each step.
create or replace function public.price_quote(p_original_unit_cents integer, p_discount_pct integer, p_quantity integer, p_tax_rate_bps integer)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  fixed boolean := coalesce((select value #>> '{}' from public.settings where key = 'service_fee_mode'), 'percent') = 'fixed';
  fee_bps integer := case when fixed then 0 else public.setting_int('service_fee_bps') end;
  unit integer := floor((p_original_unit_cents * (100 - p_discount_pct))::numeric / 100 + 0.5);
  subtotal integer := unit * p_quantity;
  fee integer := case when fixed then coalesce(public.setting_int('service_fee_fixed_cents'), 0)
                      else floor((subtotal * fee_bps)::numeric / 10000 + 0.5)::integer end;
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
