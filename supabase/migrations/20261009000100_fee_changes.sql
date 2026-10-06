-- Subscription fee changes, renewal reminders and fee-change emails.
--
-- An admin schedules a fee change (owner console → Plans): new prices that take effect at 12:01 AM Pacific Time on a
-- chosen date, and either
--   * existing restaurants keep paying what they pay now (their price is locked when the change takes effect), and only
--     restaurants that start a plan from then on pay the new prices; or
--   * existing restaurants pay the new prices from their first renewal on or after that date.
-- Every restaurant is emailed straight away, with a message picked from editable templates.

-- A restaurant's locked ("grandfathered") prices. When set, renewals use them instead of the current prices.
alter table public.restaurant_subscriptions
  add column locked_monthly_cents integer check (locked_monthly_cents > 0),
  add column locked_annual_cents integer check (locked_annual_cents > 0);

create table public.subscription_price_changes (
  id bigint generated always as identity primary key,
  monthly_cents integer not null check (monthly_cents > 0),
  annual_cents integer not null check (annual_cents > 0),
  previous_monthly_cents integer not null,
  previous_annual_cents integer not null,
  -- 12:01 AM Pacific Time on the effective date.
  effective_at timestamptz not null,
  -- true: existing restaurants pay the new prices from their next renewal; false: they keep their current prices.
  applies_to_existing boolean not null,
  template_name text not null default '',
  subject text not null,
  body text not null,
  include_founding boolean not null default false,
  emails_sent integer not null default 0,
  emails_failed integer not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  cancelled_at timestamptz
);
create index subscription_price_changes_pending_idx on public.subscription_price_changes (effective_at)
  where applied_at is null and cancelled_at is null;

-- Email texts an admin picks from when announcing a fee change. Placeholders: {{restaurant}}, {{effective_date}},
-- {{old_monthly}}, {{new_monthly}}, {{old_annual}}, {{new_annual}} and {{your_plan}} (what the change means for
-- that restaurant).
create table public.fee_email_templates (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 2 and 60),
  subject text not null check (char_length(subject) between 2 and 200),
  body text not null check (char_length(body) between 2 and 5000),
  updated_at timestamptz not null default now()
);

alter table public.subscription_price_changes enable row level security;
alter table public.fee_email_templates enable row level security;
-- Only admins read them; the server (service role) writes them.
create policy "admins read price changes" on public.subscription_price_changes for select to authenticated using ((select public.is_admin()));
create policy "admins read fee email templates" on public.fee_email_templates for select to authenticated using ((select public.is_admin()));

insert into public.fee_email_templates (name, subject, body) values
('Rising operating costs',
 'Bite Wise subscription fees are changing on {{effective_date}}',
 'Hi {{restaurant}},

We''re writing to let you know that Bite Wise subscription fees will change effective {{effective_date}} at 12:01 AM Pacific Time.

Over the past year, the costs of running Bite Wise (payment processing, hosting, customer support and the tools behind your dashboard and counter kiosk) have gone up. To keep the platform fast, reliable and growing, we are adjusting our prices.

{{your_plan}}

There is still no commission on your sales, and every feature stays included. Thank you for rescuing good food with us.

The Bite Wise team'),
('New features and improvements',
 'More from Bite Wise, and updated plan prices from {{effective_date}}',
 'Hi {{restaurant}},

Bite Wise keeps growing: more customers nearby, the counter kiosk for your tablet, live order alerts, daily reports and faster payouts. To keep investing in new features for partners like you, our subscription fees will change effective {{effective_date}} at 12:01 AM Pacific Time.

{{your_plan}}

As always, you keep 100% of your food sales: no commission, no hidden fees.

Thank you for being part of Bite Wise.
The Bite Wise team'),
('Annual price review',
 'Your Bite Wise plan: price update effective {{effective_date}}',
 'Hi {{restaurant}},

As part of our yearly price review, Bite Wise subscription fees will change effective {{effective_date}} at 12:01 AM Pacific Time:

Monthly plan: {{old_monthly}} → {{new_monthly}} per month
Annual plan: {{old_annual}} → {{new_annual}} per year

{{your_plan}}

You can switch between monthly and annual, change your card or turn off auto-renewal at any time in the Plan tab of your dashboard.

The Bite Wise team'),
('Introductory pricing ends',
 'Bite Wise introductory pricing ends on {{effective_date}}',
 'Hi {{restaurant}},

When we launched Bite Wise, we offered partners introductory prices. That introductory period ends on {{effective_date}} at 12:01 AM Pacific Time, when our standard subscription fees take effect.

{{your_plan}}

Thank you for being one of our early partners. We couldn''t rescue all this good food without you.

The Bite Wise team');

insert into public.settings (key, value) values
  ('renewal_reminder_days_annual', '30'),
  ('renewal_reminder_days_monthly', '7')
on conflict (key) do nothing;

-- The restaurant agreement now says when renewal reminders are sent and that partners are told about fee changes.
update public.legal_documents set version = '2026-10-09.1';
