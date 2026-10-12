-- Sales tax on restaurant plan fees (Bite Wise's platform fees) follows Bite Wise's own location in each country,
-- not the restaurant's: Washington for restaurants in the United States, Newfoundland and Labrador (HST) for
-- restaurants in Canada. The rates are editable in the admin Settings (each admin sees their own country's).
insert into public.settings (key, value) values
  ('platform_tax_rate_bps_us', '1035'),
  ('platform_tax_label_us', '"Washington (Seattle)"'),
  ('platform_tax_rate_bps_ca', '1500'),
  ('platform_tax_label_ca', '"Newfoundland and Labrador HST"')
on conflict (key) do nothing;

-- The Partner Agreement now says plan fees are taxed at Bite Wise's location (Washington / Newfoundland and Labrador).
update public.legal_documents set version = '2026-10-20.1';
