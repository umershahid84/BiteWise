-- Food photos: public bucket. Uploads go through the server (which checks the file signature),
-- so there are no insert policies for API users.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('food-photos', 'food-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Live updates over WebSockets (Supabase Realtime). RLS decides who receives each change:
-- restaurants get their new orders (the bell), customers see their own orders and the live offer feed.
alter publication supabase_realtime add table public.orders, public.offers;

-- Clean up every minute: stale checkouts, missed pickups and expired offers.
-- The /api/cron/sweep route runs the same sweep and also voids card holds with the payment provider.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('bitewise-sweep', '* * * * *', 'select public.sweep()');
exception when others then
  raise notice 'pg_cron is not available (%); schedule /api/cron/sweep instead.', sqlerrm;
end;
$$;
