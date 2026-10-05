-- Restaurants deleted from the owner console. One with sales, payouts or plan payments keeps its records (for sales
-- and tax reporting) under status 'deleted': it is off the site, its owner's login is erased, and it no longer shows
-- in the owner console's lists. One with no history is removed completely.
alter type public.restaurant_status add value if not exists 'deleted';
