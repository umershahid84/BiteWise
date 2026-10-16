-- The business is now called ResDish (it was Bite Wise).
--   * Every database function whose messages name the business (e.g. "Please contact Bite Wise support.") is
--     recreated with the new name, straight from its current definition, so nothing else in it changes.
--   * The saved fee-change and coupon email templates (including admins' own) say ResDish.
--   * New plan invoices are numbered RD-SUB-000001, ... (the count carries on; past invoices keep their numbers).
--   * The legal documents name ResDish, so everyone accepts the new version (src/lib/legal/documents.ts).
-- The every-minute cleanup job keeps its technical name (bitewise-sweep).
do $$
declare
  f record;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%Bite Wise%'
  loop
    execute replace(pg_get_functiondef(f.oid), 'Bite Wise', 'ResDish');
  end loop;
end;
$$;

update public.fee_email_templates set name = replace(name, 'Bite Wise', 'ResDish'), subject = replace(subject, 'Bite Wise', 'ResDish'),
  body = replace(body, 'Bite Wise', 'ResDish')
  where name like '%Bite Wise%' or subject like '%Bite Wise%' or body like '%Bite Wise%';
update public.coupon_email_templates set name = replace(name, 'Bite Wise', 'ResDish'), subject = replace(subject, 'Bite Wise', 'ResDish'),
  body = replace(body, 'Bite Wise', 'ResDish')
  where name like '%Bite Wise%' or subject like '%Bite Wise%' or body like '%Bite Wise%';

create or replace function public.next_subscription_invoice() returns text
language sql security definer set search_path = public as $$
  select 'RD-SUB-' || lpad(nextval('public.subscription_invoice_seq')::text, 6, '0');
$$;

update public.legal_documents set version = '2026-10-24.1';
