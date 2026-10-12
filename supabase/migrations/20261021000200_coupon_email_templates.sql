-- Email templates for coupons: an admin picks one, edits it and sends the coupon to every customer in their location.
-- Placeholders: {{name}} (the customer's user name), {{code}}, {{offer}} (e.g. "20% off your food"), {{expires}} (the
-- last day it works) and {{message}} (the coupon's own message, if any).
create table public.coupon_email_templates (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 2 and 60),
  subject text not null check (char_length(subject) between 2 and 200),
  body text not null check (char_length(body) between 2 and 5000),
  updated_at timestamptz not null default now()
);
alter table public.coupon_email_templates enable row level security;
-- Only admins read them; the server (service role) writes them.
create policy "admins read coupon email templates" on public.coupon_email_templates for select to authenticated using ((select public.is_admin()));

alter table public.coupons add column email_subject text not null default '';

insert into public.coupon_email_templates (name, subject, body) values
('A thank-you treat',
 'A thank-you from Bite Wise: {{offer}}',
 'Hi {{name}},

Thank you for rescuing good food with Bite Wise! Every order you pick up keeps a meal out of the trash, and we wanted to say thanks.

Here''s {{offer}} on your next order. Enter the code below at checkout before {{expires}}.

{{message}}

Happy rescuing,
The Bite Wise team'),
('Weekend special',
 'This weekend only: {{offer}} on Bite Wise',
 'Hi {{name}},

Restaurants near you are posting their end-of-day surplus all weekend, and this one is on us: {{offer}}.

Use the code below at checkout. It works until {{expires}}, so grab a deal before it''s gone.

{{message}}

The Bite Wise team'),
('We miss you',
 '{{name}}, we saved you something: {{offer}}',
 'Hi {{name}},

It''s been a while! Restaurants near you are still saving good food from going to waste, at big discounts.

Come back and enjoy {{offer}} on your next order, with the code below. It''s valid until {{expires}}.

{{message}}

See you soon,
The Bite Wise team'),
('Holiday greetings',
 'Happy holidays from Bite Wise: {{offer}}',
 'Hi {{name}},

Happy holidays from all of us at Bite Wise! Thank you for helping local restaurants waste less food this year.

Our gift to you: {{offer}} on an order of your choice, until {{expires}}. Just enter the code below at checkout.

{{message}}

Warm wishes,
The Bite Wise team');
