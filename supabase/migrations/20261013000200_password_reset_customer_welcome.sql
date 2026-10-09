-- Forgot password (a 6-digit code by email) and the customer welcome email.

-- The code is checked by Supabase Auth; these limit guessing: after 5 wrong codes the code stops working and a new
-- one has to be requested (at most one a minute).
alter table public.profiles
  add column password_reset_sent_at timestamptz,
  add column password_reset_attempts integer not null default 0,
  -- Customers get a welcome email (with the phone app install buttons) once they confirm their email.
  add column welcome_email_sent_at timestamptz;

-- Customers who signed up before this change don't get a welcome email now.
update public.profiles set welcome_email_sent_at = created_at where role = 'customer';
