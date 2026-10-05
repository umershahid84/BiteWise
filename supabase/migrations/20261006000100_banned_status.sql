-- Permanent bans, for people and restaurants. New enum values can't be used in the migration that adds them,
-- so they get their own file; 20261006000200_bans_and_subscriptions.sql uses them.
alter type public.account_status add value if not exists 'banned';
alter type public.restaurant_status add value if not exists 'banned';
