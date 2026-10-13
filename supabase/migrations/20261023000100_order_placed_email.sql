-- The "order placed" email (hold receipt, pickup PIN and a Drive to Restaurant button) is sent once, when the order's
-- card hold succeeds (src/lib/orders.ts emailOrderPlaced). This records that it went out, so the browser, the 3-D
-- Secure return and Stripe's webhook can all ask for it without sending it twice.
alter table public.orders add column placed_email_at timestamptz;
