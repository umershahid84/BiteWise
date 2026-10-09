-- Admin employees ("support"): they work in the owner console with limited access (accounts, bans, emails,
-- orders, live offers). A new enum value has to be committed before it is used, so it gets its own migration
-- (the rest is in 20261014000200_admin_team.sql).
alter type public.user_role add value if not exists 'support';
