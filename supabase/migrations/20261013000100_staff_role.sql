-- Restaurant staff (managers and supervisors) log in with their own user name and password, created by the owner.
-- A new enum value has to be committed before it is used, so it gets its own migration
-- (the rest is in 20261013000300_restaurant_staff.sql).
alter type public.user_role add value if not exists 'staff';
