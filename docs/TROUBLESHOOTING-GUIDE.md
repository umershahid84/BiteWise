# ResDish: Operations & Troubleshooting Guide

This guide covers everything on the ResDish platform: where each thing lives, how to change it, and what to do when something goes wrong. Use it if you are taking over the platform, filling in for the owner, or just need to make a quick change.

> **Keep this guide current.** Whenever a feature, setting, service, email, file or fix is added or changed, update the matching section here **in the same commit**, and add a line to the [Change log](#21-change-log) at the bottom.

**Last updated:** 2026-10-17

---

## Contents

1. [Quick facts](#1-quick-facts)
2. [How to find anything in the code](#2-how-to-find-anything-in-the-code)
3. [Accounts and services (who hosts what)](#3-accounts-and-services-who-hosts-what)
4. [Environment variables (Vercel settings)](#4-environment-variables-vercel-settings)
5. [Admin settings (changed in the app, no code)](#5-admin-settings-changed-in-the-app-no-code)
6. [Where things live: quick lookup table](#6-where-things-live-quick-lookup-table)
7. [Pages and addresses on the website](#7-pages-and-addresses-on-the-website)
8. [Features, one by one](#8-features-one-by-one)
9. [Money: prices, fees, taxes, coupons, credit](#9-money-prices-fees-taxes-coupons-credit)
10. [Payments: Stripe US and Canada](#10-payments-stripe-us-and-canada)
11. [Email](#11-email)
12. [Database (Supabase)](#12-database-supabase)
13. [Scheduled jobs](#13-scheduled-jobs)
14. [Legal documents](#14-legal-documents)
15. [Branding, text and images](#15-branding-text-and-images)
16. [Demo videos](#16-demo-videos)
17. [Business documents](#17-business-documents)
18. [Deploying changes](#18-deploying-changes)
19. [Troubleshooting: symptom → fix](#19-troubleshooting-symptom--fix)
20. [Common changes: step by step](#20-common-changes-step-by-step)
21. [Change log](#21-change-log)

---

## 1. Quick facts

| | |
|---|---|
| **Product** | ResDish: restaurants sell surplus food at a discount; customers order, pay with a card hold, and pick up with a 4-digit PIN. The card is charged only at pickup. |
| **Countries** | United States (US dollars, miles, ZIP codes) and Canada (Canadian dollars, kilometres, postal codes) |
| **Website** | https://www.bite-wise.org |
| **Support email** | support@bite-wise.org |
| **Code** | GitHub: `umershahid84/RescueBites`, branch **`main`** (everything is pushed straight to `main`) |
| **Hosting** | Vercel project **bite-wise** (deploys automatically from `main`) |
| **Database & logins** | Supabase (PostgreSQL + Auth + Storage + Realtime) |
| **Payments** | Stripe Connect: one Stripe account for the US, a separate one for Canada |
| **App email** | SMTP (Resend recommended) |
| **Tech** | Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Supabase, Stripe, Leaflet maps, pdfkit |
| **Demo password** | `BiteWise123` (demo data only: customer `demo`, admin `admin`, restaurants `harborpho`, `ballardbread`, …) |

**Three kinds of users:**
- **Customers:** browse deals, order, pick up. Pages: `/offers`, `/orders`, `/account`.
- **Restaurants** (owners and their staff): post surplus food, verify pickups, get paid. Pages: `/restaurant`, kiosk `/kiosk/<link>`.
- **Admin team** (admins and employees): run the platform. Page: `/admin`.

---

## 2. How to find anything in the code

The fastest way to find where a word, email, price or label appears is to **search the whole repository**.

**On GitHub (no setup needed):** open the repository, press `/` (or click the search box), type the text in quotes, e.g. `"support@bite-wise.org"`, and choose **Code**.

**On your computer** (in the project folder):

```bash
git grep -n "support@bite-wise.org"          # every line with that text, with file and line number
git grep -n -i "service fee"                 # -i ignores upper/lower case
git grep -l "Pioneer"                        # only the file names
git grep -n "support@bite-wise.org" -- ':!legacy'   # skip the old legacy/ folder
```

**In VS Code:** press `Ctrl+Shift+F` (Windows) or `Cmd+Shift+F` (Mac) and type the text.

> **Ignore the `legacy/` folder.** It holds the original version of the app and is no longer used. Changes there have no effect.

### Example: where is `support@bite-wise.org`?

The support email comes from the `SUPPORT_EMAIL` setting (see [section 4](#4-environment-variables-vercel-settings)). **Changing `SUPPORT_EMAIL` in Vercel updates most places at once**: email footers, the legal documents, the signed agreement PDF and the map lookup's contact address. A few places have it typed in directly and must be edited by hand:

| File | What it is |
|---|---|
| `src/lib/env.ts` (line ~32) | Fallback used when `SUPPORT_EMAIL` isn't set; also `no-reply@bite-wise.org`, the fallback "from" address (line ~43) |
| `src/components/receipts/pos-receipt.tsx` (line ~105) | Bottom of the on-screen receipt |
| `src/lib/receipts/pdf.ts` (line ~189) | Bottom of the PDF receipt |
| `supabase/templates/confirmation.html` (line ~122) | The "confirm your email" sign-up email |
| `.env.example` | Example settings file |
| `docs/business/ResDish-Restaurant-Sales-Pitch.pptx` / `.pdf` | Sales deck (closing slide) |
| `docs/business/ResDish-Restaurant-Partnership-Proposal.docx` / `.pdf` | Partnership proposal (closing details) |

Places that use the setting (no edit needed): `src/lib/email/templates.ts`, `src/lib/legal/documents.ts`, `src/lib/legal/agreement-pdf.ts`, `src/lib/geocode.ts`.

The same approach works for anything else: search for the text you see on the screen, and you'll find the file it comes from.

---

## 3. Accounts and services (who hosts what)

> Never write passwords or secret keys in this file, in the code, or in chat. They belong only in Vercel's Environment Variables (and your password manager).

| Service | What it does for ResDish | Where to manage it |
|---|---|---|
| **GitHub** (`umershahid84/RescueBites`) | Stores the code. Every push to `main` deploys the site. | github.com |
| **Vercel** (project `bite-wise`) | Runs the website, holds all secret settings, runs the daily scheduled job | vercel.com → bite-wise → Settings → Environment Variables / Domains / Deployments |
| **Supabase** | Database, user logins, food photo storage, live updates, every-minute cleanup (`pg_cron`) | supabase.com → your project |
| **Stripe (US)** | Card payments in US dollars, payouts to US restaurants. Connected through Vercel's Stripe integration (sandbox for now). | dashboard.stripe.com (the US account's email) |
| **Stripe (Canada)** | Card payments in Canadian dollars, payouts to Canadian restaurants. Separate Stripe account, separate email. Keys added by hand in Vercel. | dashboard.stripe.com (the Canada account's email) |
| **Resend** | Sends the app's emails (receipts, codes, welcomes) from `@bite-wise.org` | resend.com → Domains / Emails / API keys |
| **Domain email host** (`mailserver.businessidentity.llc`) | The support@bite-wise.org inbox (read on phone/computer: IMAP 993, SMTP 465) | Your domain/email provider |
| **Domain DNS** | Points bite-wise.org to Vercel, holds Resend's verification records | Where the domain was bought |
| **OpenStreetMap / US Census / Nominatim** | Free map tiles and address lookups (no account) | n/a |
| **WA Department of Revenue** | Free Washington sales tax rate lookup (no account) | n/a |
| **Anthropic (optional)** | Reads hard-to-parse restaurant menus during Menu import | console.anthropic.com (`ANTHROPIC_API_KEY`) |

---

## 4. Environment variables (Vercel settings)

These are set in **Vercel → bite-wise → Settings → Environment Variables**. After changing any of them, **redeploy** (Deployments → latest → ⋯ → Redeploy), because changes only apply to new deployments. For local development they go in `.env.local` (copy `.env.example`). The full list with comments is in `.env.example`; the code that reads them is `src/lib/env.ts`.

### Required

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project address |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase public key |
| `SUPABASE_SECRET_KEY` | Supabase secret key (server only) |
| `NEXT_PUBLIC_SITE_URL` | The site address: `https://www.bite-wise.org`. Used in every email link. |
| `CRON_SECRET` | Password Vercel's scheduled job uses to call `/api/cron/sweep` |

### Payments (Stripe)

| Variable | What it is |
|---|---|
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | **US** Stripe account (set by Vercel's Stripe integration) |
| `STRIPE_WEBHOOK_SECRET` | US webhook signing secret(s), comma-separated if there are two (optional while testing) |
| `STRIPE_SECRET_KEY_CA`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_CA` | **Canada** Stripe account (added by hand) |
| `STRIPE_WEBHOOK_SECRET_CA` | Canada webhook signing secret(s) |
| `STRIPE_TAX=on` | Optional: exact US sales tax rates via Stripe Tax (paid per lookup). `STRIPE_TAX_CODE` overrides the product tax code. |

No Stripe keys at all = built-in **test mode** (nothing is charged; test card `4242 4242 4242 4242`). Keys for only one country = card payments in the other country show "not available yet".

### Email

| Variable | Value with Resend |
|---|---|
| `SMTP_HOST` | `smtp.resend.com`. **Without this, no email is sent** (only logged). |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `resend` |
| `SMTP_PASSWORD` | the Resend API key |
| `EMAIL_FROM` | `ResDish <no-reply@bite-wise.org>` (must be on the verified domain) |
| `SUPPORT_EMAIL` | `support@bite-wise.org` |

### Company details

| Variable | Default |
|---|---|
| `LEGAL_ENTITY_NAME` | `ResDish` |
| `SUPPORT_EMAIL` | `support@bite-wise.org` |
| `LEGAL_ADDRESS` | `Federal Way, Washington`: ResDish's location in the **US** documents ("ResDish (Federal Way, Washington)" in the US agreement, its signed PDF and the US legal pages) |
| `LEGAL_ADDRESS_CA` | `St. John's, Newfoundland and Labrador`: the same, in the **Canadian** documents |

### Optional switches

| Variable | Effect |
|---|---|
| `TIME_ZONE` | Time zone for reports and receipts (default `America/Los_Angeles`) |
| `PICKUP_GRACE_MINUTES` | Minutes after the discard timer before an unclaimed order is released (default 10) |
| `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_ATTRIBUTION`, `NEXT_PUBLIC_MAP_DARK_FILTER` | Map tiles (use a commercial tile provider for heavy traffic) |
| `GEOCODING=off` | Turns off address → map position lookups |
| `TAX_LOOKUP=off` | Turns off automatic sales tax rate lookups |
| `ANTHROPIC_API_KEY` | Lets Menu import read unusual menu layouts and menu pictures |
| `MENU_IMPORT_BROWSER=off`, `CHROMIUM_PATH` | Hidden browser used by Menu import |
| `DISABLE_SCHEDULED_JOBS=1` | Self-hosted server only: stop its own 5-minute job loop |
| `TRUSTED_ORIGINS` | Only when opening the app through a tunnel/proxy |
| `SUPABASE_ACCESS_TOKEN` | Only for `npm run email:template` |

**Not used by the app** (safe to delete from Vercel): `RESEND_API_KEY`, `MAIL_TO`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, the `POSTGRES_*` and `SUPABASE_JWT_SECRET` values, `STRIPE_MCP_KEY`. Some are added automatically by integrations; leaving them does no harm.

---

## 5. Admin settings (changed in the app, no code)

Log in at `/admin/login` → **Settings** tab (admins only). These are stored in the database table `settings`. Admins only see and change **their own country's** data (set on their profile: US or Canada).

| Setting (screen label) | Database key | Default |
|---|---|---|
| Service fee: percentage **or** fixed amount | `service_fee_mode` (`percent` / `fixed`), `service_fee_bps`, `service_fee_fixed_cents` | 5% (fixed: $0.99) |
| Welcome bonus for new customers ($) | `welcome_credit_cents` | $10.00 (0 turns it off) |
| Tax on the service fee: rate and **Tax name** | `platform_tax_rate_bps_us` / `_ca`, `platform_tax_label_us` / `_ca` | US 10.35% "Washington (Seattle)"; Canada 15% "Newfoundland and Labrador HST" |
| Starting sales tax for new restaurants (%) | `default_tax_rate_bps` | 10.35% |
| New restaurants need my approval | `require_restaurant_approval` | on |

**Plans tab → Plan settings / Change subscription fees:**

| Setting | Key | Default |
|---|---|---|
| Monthly plan price | `subscription_monthly_cents` | $15.00 |
| Annual plan price | `subscription_annual_cents` | $150.00 |
| Pioneer (free) spots | `founding_spots` | 50 |
| Renewal reminder (days before) | `renewal_reminder_days_annual` / `_monthly` | 30 / 7 |
| States where plan fees are taxed | `plan_tax_states` | WA |

**Not on a screen** (change with SQL in Supabase → SQL Editor: `update settings set value = '…' where key = '…';`):

| Key | Meaning | Default |
|---|---|---|
| `no_show_limit` | Missed pickups in a row before a 30-day suspension | 3 |
| `no_show_suspension_days` | Length of that suspension | 30 |
| `order_tax_to_restaurant` | Restaurant receives the sales tax on its food | true |

---

## 6. Where things live: quick lookup table

| I want to change… | Look in |
|---|---|
| Home page text, buttons | `src/app/page.tsx` |
| About us page / founder photos | `src/app/about/page.tsx`; photos in `public/about/` |
| Header / footer links | `src/components/app/site-header.tsx`, `src/components/app/site-footer.tsx` |
| Logo | `public/assets/logo*.svg`, `logo.png`, `email-logo.png`, app icons in `public/assets/`; component `src/components/app/logo.tsx` |
| Colors / looks (customer, restaurant, admin) | `src/app/globals.css` (color tokens), `src/lib/theme.ts` |
| Login / sign-up forms | `src/components/auth/` (`login-form.tsx`, `signup-form.tsx`, `password-reset.tsx`) |
| Deals page, search box, map, distance filter | `src/components/offers/offers-browser.tsx`, `offers-map.tsx`, `offer-card.tsx` |
| Checkout (order form, coupon box, totals) | `src/components/offers/checkout-dialog.tsx` |
| Card entry form (ZIP / postal code box) | `src/components/payments/card-entry.tsx` |
| Customer "My orders" | `src/components/orders/orders-list.tsx` |
| Customer account page (postal code, cards, password) | `src/components/account/account-panel.tsx` |
| Restaurant dashboard tabs | `src/components/restaurant/` (`dashboard.tsx` and one `*-panel.tsx` per tab) |
| Counter kiosk | `src/app/kiosk/[token]/page.tsx`, `src/components/kiosk/kiosk-app.tsx`, `src/lib/kiosk.ts` |
| Admin console tabs | `src/components/admin/` (one file per tab), data in `src/lib/admin.ts`, actions in `src/app/actions/admin.ts` |
| Emails (all except sign-up) | `src/lib/email/templates.ts` |
| Sign-up confirmation email | `supabase/templates/confirmation.html`, sent by `src/lib/email/confirmation.ts` |
| Email sending (SMTP) | `src/lib/email/send.ts` |
| Receipt (screen) / receipt PDF / reports PDF | `src/components/receipts/pos-receipt.tsx`, `src/lib/receipts/pdf.ts`, `src/lib/receipts/data.ts` |
| Restaurant daily report | `src/components/restaurant/report-view.tsx`, `src/app/restaurant/report/page.tsx` |
| Plan invoices | `src/app/restaurant/invoices/[id]/page.tsx`, `src/lib/receipts/plan-invoice.ts` |
| CSV / PDF downloads in admin | `src/lib/exports.ts`, `src/app/api/admin/export/[kind]/route.ts` |
| Legal documents (Terms, Agreement, Privacy) | `src/lib/legal/documents.ts` |
| Signed agreement PDF | `src/lib/legal/agreement-pdf.ts` |
| Prices and money math | `src/lib/pricing.ts` (browser preview), database function `price_quote` (the real numbers) |
| Service fee wording | `src/lib/service-fee.ts` |
| Coupons | `src/lib/coupons.ts`, `src/components/admin/coupons.tsx` |
| Welcome bonus | `src/lib/customer-welcome.ts` |
| Orders, pickup, refunds, payouts | `src/lib/orders.ts` |
| Stripe | `src/lib/payments/stripe.ts`, `src/lib/payments/index.ts`, webhook `src/app/api/stripe/webhook/route.ts` |
| Test-mode payments | `src/lib/payments/mock.ts` |
| Restaurant plans / renewals / Pioneer | `src/lib/subscriptions.ts`, `src/lib/fee-changes.ts`, `src/components/restaurant/plan-panel.tsx`, `src/components/admin/plans.tsx` |
| Sales tax rates | `src/lib/tax/states.ts` (US), `src/lib/tax/provinces.ts` (Canada), lookups `src/lib/tax/lookup.ts`, `src/lib/restaurant-tax.ts` |
| Countries, provinces, postal code formats, address lines, map links | `src/lib/regions.ts` |
| Miles / km, money formatting | `src/lib/format.ts` |
| Phone number format | `src/lib/phone.ts` |
| Map position of restaurants | `src/lib/geocode.ts`, `src/lib/restaurant-location.ts`, `src/components/restaurant/pin-map.tsx` |
| Missed pickups (no-shows) | `src/lib/no-shows.ts` |
| Suspend / ban | `src/lib/moderation.ts` |
| Admin team / employees | `src/lib/team.ts`, `src/components/admin/team.tsx` |
| Restaurant staff | `src/lib/staff.ts`, `src/components/restaurant/staff-panel.tsx` |
| Menu import | `src/lib/menu-import/`, `src/components/restaurant/menu-import.tsx` |
| Fake-email blocking at sign-up | `src/lib/email-domain.ts` |
| Forgot password | `src/lib/password-reset.ts` |
| Auto log-out after 10 minutes | `src/components/app/idle-logout.tsx` |
| Who may do what (permissions) | `src/lib/auth.ts`, plus database rules in `supabase/migrations/` |
| Scheduled jobs | `src/lib/jobs.ts`, `src/app/api/cron/sweep/route.ts`, `vercel.json`, `src/instrumentation.ts` |
| Database tables and functions | `supabase/migrations/` (newest file = latest change) |
| Demo data | `scripts/seed.ts` |
| Demo videos | `public/videos/`, `scripts/demo-video/` |
| Business documents (proposal, deck, checklist) | `docs/business/`, `docs/production/` |
| Tests | `tests/unit/`, `tests/integration/` |

---

## 7. Pages and addresses on the website

| Address | Who | What |
|---|---|---|
| `/` | everyone | Home page, demo videos |
| `/about` | everyone | About us |
| `/signup` (`?role=restaurant`), `/restaurant/signup` | new users | Sign up (customer / restaurant slider) |
| `/login`, `/restaurant/login` | customers, restaurants, staff | Log in |
| `/admin/login` | admin team | Admin log in |
| `/offers` | customers | Deals near you (list / map) |
| `/orders`, `/orders/[id]/receipt` | customers | My orders, receipts |
| `/account` | customers | ZIP/postal code, saved cards, credit, password |
| `/app` | customers | Install ResDish on Android / iPhone / Windows |
| `/restaurant` | restaurants | Dashboard: Verify pickup, Offers, Menu, Orders, Payouts, Kiosk, Plan, Staff, Profile |
| `/restaurant/report` | restaurant owners | Daily sales report (print, PDF, CSV) |
| `/restaurant/invoices/[id]` | restaurant owners | Plan invoice |
| `/kiosk/<secret>` | restaurant counter tablet | Kiosk (no login; the link is the key) |
| `/admin` | admin team | Console: Overview, Income, Alerts, Restaurants, Plans, Coupons, Customers, Orders, Live offers, Payouts, Sales tax, Settings, Team, Audit log |
| `/legal/customer-terms`, `/legal/restaurant-agreement`, `/legal/privacy` (add `-ca` for Canada) | everyone | Legal documents |
| `/auth/confirm` | email links | Confirms sign-up emails |
| `/directions/[restaurantId]` | email button | **Drive to Restaurant**: sends iPhones/iPads/Macs to Apple Maps and everything else to Google Maps, with driving directions to the restaurant's address (`directionsUrl` in `src/lib/regions.ts`) |
| `/api/stripe/webhook` | Stripe | Payment updates |
| `/api/cron/sweep` | Vercel cron | Scheduled jobs |

---

## 8. Features, one by one

**Customers**
- **Sign-up:** email, user name, password, country, state/province and ZIP/postal code; must accept Terms and Privacy Policy (declining creates no account). Disposable/fake email domains are refused (`src/lib/email-domain.ts`). A confirmation email is sent; after confirming they get the **welcome email** and the **$10 welcome bonus**.
- **Deals page:** nearest deals to their ZIP/postal code first; list or map; search by dish/restaurant/city/code; filters for diet, distance (miles in the US, km in Canada) and sort. The city/code suggestions list places that have restaurants in the customer's own country.
- **Checkout:** quantity, coupon code, platform credit, saved or new card. Totals: food, service fee, one combined **Sales tax** line, total. The card is only **held**; it's charged at pickup.
- **Emails:** when the order is placed, an **Order placed** email (hold receipt PDF, PIN, pick-up-by time, address, **Drive to Restaurant** button). At pickup, a **Payment confirmed** receipt (PDF) without directions.
- **Pickup:** 4-digit PIN shown at the counter.
- **Cancelling / missed pickups:** cancelling before pickup or missing the pickup charges only the service fee (non-refundable). **3 missed pickups in a row → 30-day suspension; the next one after that → permanent ban.** Emails are sent each time; admins get an alert.
- **Auto log-out** after 10 minutes without activity (kiosk excluded).
- **Forgot password:** a code by email (valid 1 hour), then a new password typed twice.

**Restaurants**
- **Sign-up:** restaurant details, address, country; accepts the Restaurant Partner Agreement. Gets three emails: confirm email → application pending → welcome (with signed agreement PDF and kiosk link) after approval.
- **Dashboard tabs:** Verify pickup, Offers (post surplus with discount, quantity, discard timer; +30m/+1h, pause, end), Menu (photos, dietary tags, **Import menu** from website or spreadsheet), Orders (bell on new orders), Payouts (connect Stripe; every payment with invoice number), Kiosk (tablet link, QR code, new link), Plan, Staff (managers/supervisors with their own logins and limited access), Profile (address, phone, map pin with **Find my address** and drag-to-adjust).
- **Plans:** Pioneer Member (first 50, free), Monthly ($15), Annual ($150). Auto-renewal with the default card; a declined payment makes the plan **delinquent** (offers paused until paid; retried daily for 7 days).
- **Sales tax rate** is looked up automatically from the address and refreshed every 30 days.

**Admin team**
- **Admins** see everything; **employees** see only Alerts, Restaurants, Customers, Orders and Live offers (refunds only if allowed). Each admin/employee belongs to the **US or Canada** and sees only that country.
- Approve restaurants, suspend (5–30 days) or ban, delete accounts (history kept for tax), correct emails/names, resend emails, issue credit, refund orders (by % or amount, to card or as credit), send payouts, create and email **coupons**, change fees, export CSV/PDF everywhere. Every action is in the **Audit log**.

---

## 9. Money: prices, fees, taxes, coupons, credit

All amounts are stored in **cents**; rates in **basis points** (1035 = 10.35%). The real calculation happens in the database function `price_quote` (see `supabase/migrations/`, latest version in `20261021000100_coupons.sql`); `src/lib/pricing.ts` mirrors it for previews.

**An order:**

| Part | Rate | Who gets it |
|---|---|---|
| Food (discounted price × quantity, minus any food coupon) | set by the restaurant | **Restaurant** |
| Sales tax on the food | restaurant's own rate (from its address) | **Restaurant** (setting `order_tax_to_restaurant`) |
| Service fee (also called the platform fee) | 5% of the food, or a fixed amount (admin setting) | **ResDish** (non-refundable) |
| Tax on the service fee | US: Washington rate (10.35%); Canada: NL HST (15%), admin setting | **ResDish** (must remit it) |

The customer sees the two taxes added together as **one "Sales tax" line**. Currency follows the **restaurant's country** (US$ or CA$), and the charge goes to that country's Stripe account.

**Coupons** (admin → Coupons tab; `src/lib/coupons.ts`):
- **No service fee:** waives the fee and its tax. **Paid by ResDish.**
- **Fixed amount** off the food, or **percentage** off the food. **Paid by the restaurant** (its food amount is lower). Explained in the Restaurant Partner Agreement.
- Each coupon has an expiry date, works only in its country, once per customer, one per order. Admins can email a coupon to all customers in their country using editable templates.

**Platform credit:** welcome bonus ($10 default), goodwill credit and refunds-as-credit. The restaurant is still paid in full; ResDish pays for the credit.

**Refunds:** food is sold as is and all sales are final; admins may give courtesy refunds (10/25/50/75/100% or an amount, to the card or as credit). The service fee is never refunded.

**Restaurant plans:** $15/month or $150/year (+ sales tax in states listed in `plan_tax_states`); first 50 restaurants free for life (Pioneer Members, $0 invoices). Invoice numbers look like `RD-SUB-000001`.

---

## 10. Payments: Stripe US and Canada

- **Which account is used:** the **restaurant's country**. US restaurant → US Stripe account, US dollars. Canadian restaurant → Canada Stripe account, Canadian dollars. Customers never choose.
- **How a charge works:** at order time a **hold** is placed (manual capture). At pickup (PIN entered) the hold is captured; Stripe sends the food + its tax to the restaurant's connected account (destination charge) and keeps the fee + fee tax for ResDish (application fee).
- **Restaurants connect** their own Stripe account in Dashboard → **Payouts** (Stripe Express). Until then they're paid manually from Admin → Payouts.
- **Test (sandbox) mode:** currently both accounts use Stripe **Sandbox** keys. Test cards: `4242 4242 4242 4242` (US Visa), `4000 0012 4000 0000` (Canadian Visa), `4000 0000 0000 0002` (declined); any future date, any CVC.
- **Postal code on the card form:** for Canadian purchases the app shows its own **Postal code** box (Stripe's own box says "ZIP" for US cards).
- **Webhooks** (`/api/stripe/webhook`): optional while testing. For live: in **each** Stripe account add an endpoint `https://www.bite-wise.org/api/stripe/webhook` for `payment_intent.amount_capturable_updated` and `payment_intent.payment_failed` (Your account) and `account.updated` (Connected accounts). Put the signing secrets in `STRIPE_WEBHOOK_SECRET` (US) / `STRIPE_WEBHOOK_SECRET_CA` (Canada), comma-separated if two.
- **Important:** the US keys were set by **Vercel's Stripe integration**. Don't reinstall that integration for Canada; it would overwrite the US keys. Add the Canada keys by hand.
- **Going live:** replace the sandbox keys with live keys (`sk_live_…`, `pk_live_…`) in Vercel, set up live webhooks, redeploy. Restaurants must connect again in live mode.

---

## 11. Email

**Two senders:**
1. **The app** sends everything it can itself through SMTP (`src/lib/email/send.ts`): sign-up confirmation (ResDish design), welcome emails, receipts with PDF, plan invoices, renewal reminders, declined-payment notices, fee-change announcements, missed-pickup warnings/suspensions/bans, admin alerts, password-reset codes, team welcomes, coupons.
2. **Supabase** sends its own stored email only as a fallback when the app can't send.

**Email list** (all in `src/lib/email/templates.ts` unless noted):

| Email | Function |
|---|---|
| Confirm your email | `supabase/templates/confirmation.html` + `src/lib/email/confirmation.ts` |
| Restaurant application pending | `applicationPendingEmail` |
| Restaurant welcome (agreement PDF, kiosk link) | `welcomeEmail` |
| Customer welcome (install app, bonus) | `customerWelcomeEmail` |
| **Order placed**: hold receipt (PDF attached), pickup PIN, pickup deadline, restaurant address and phone, **Drive to Restaurant** button. Sent once, when the card hold succeeds (`orders.placed_email_at`). | `orderPlacedEmail`, sent by `emailOrderPlaced` in `src/lib/orders.ts` |
| **Payment confirmed**: payment receipt at pickup (PDF attached), no directions | `orderInvoiceEmail`, sent by `emailInvoice` in `src/lib/orders.ts` |
| Plan receipt / invoice | `subscriptionReceiptEmail` |
| Plan payment declined | `paymentFailedEmail` |
| Plan renewal reminder | `renewalReminderEmail` |
| Fee change announcement | `feeChangeEmail` |
| Missed pickup warning / suspended / banned | `noShowWarningEmail`, `noShowSuspendedEmail`, `noShowBannedEmail` |
| Admin alert | `adminAlertEmail` |
| Password reset code | `passwordResetEmail` |
| Admin team welcome / password | `teamWelcomeEmail`, `teamPasswordEmail` |
| Coupon | `couponEmail` (templates edited in Admin → Coupons) |

**Setup with Resend:** verify `bite-wise.org` in Resend (add its DNS records), then set the SMTP variables in [section 4](#4-environment-variables-vercel-settings) and redeploy. Optional: the same SMTP details in **Supabase → Authentication → Emails → SMTP Settings**.

**Supabase login links:** **Supabase → Authentication → URL Configuration**: Site URL `https://www.bite-wise.org`, Redirect URLs include `https://www.bite-wise.org/auth/confirm`.

---

## 12. Database (Supabase)

- **All structure** (tables, security rules, money functions) is in `supabase/migrations/`, one file per change, named by date. **The newest file is applied last.**
- **Applying new migrations to the live database** (needed whenever a commit adds a file to `supabase/migrations/`):
  ```bash
  npx supabase login
  npx supabase link --project-ref <your project ref>
  npx supabase db push
  ```
  If you skip this, new features that need the database fail (e.g. errors like "function … does not exist" or "column … does not exist").
- **Security:** every table has Row Level Security; money and order changes happen only inside database functions called by the server.
- **Key tables:** `profiles` (users, role, country), `restaurants`, `restaurant_payment_accounts` (Stripe connections), `restaurant_staff`, `restaurant_kiosks`, `menu_items`, `offers`, `orders`, `order_pins`, `refunds`, `credit_ledger` (platform credit), `payouts`, `payment_methods` (saved cards), `restaurant_subscriptions`, `subscription_payments`, `subscription_price_changes`, `coupons`, `coupon_email_templates`, `fee_email_templates`, `admin_alerts`, `settings`, `legal_documents`, `terms_acceptances`, `audit_log`, `zips` (Washington ZIP list).
- **Run SQL by hand:** Supabase → SQL Editor. Be careful: this bypasses the app's checks.
- **Food photos:** Supabase Storage bucket `food-photos`; email logo in bucket `brand`.
- **Create the owner account** (admins can't sign up on the site): `npm run create-admin -- --email you@example.com --username owner` (with `.env.local` pointing at the live project).
- **Local development database:** `npm run db:start` (needs Docker), `npm run db:reset`, `npm run seed`, then `npm run db:types` after changing migrations.

---

## 13. Scheduled jobs

| Job | Where | How often |
|---|---|---|
| Cleanup: release unpaid checkouts and missed pickups | Supabase `pg_cron` job `bitewise-sweep` | every minute |
| Card holds, missed-pickup emails/suspensions, fee changes, **plan renewals and reminders**, tax rate refresh | `/api/cron/sweep` (`src/lib/jobs.ts`), called by Vercel Cron (`vercel.json`) | **once a day** at 00:00 UTC (Vercel Hobby plan limit) |
| Same, on a self-hosted server | `src/instrumentation.ts` | every 5 minutes |

If renewals or no-show emails seem late, it's because Vercel's cron runs daily. To run it now: call `https://www.bite-wise.org/api/cron/sweep` with header `Authorization: Bearer <CRON_SECRET>`, or upgrade Vercel and change the schedule in `vercel.json`.

---

## 14. Legal documents

- Text: `src/lib/legal/documents.ts` (Customer Terms, Restaurant Partner Agreement, Privacy Policy, each with US and Canada versions). Current version: **`LEGAL_VERSION = '2026-10-24.1'`** (the rename to ResDish).
- Company name/email/address come from `LEGAL_ENTITY_NAME`, `SUPPORT_EMAIL`, `LEGAL_ADDRESS` (US documents) and `LEGAL_ADDRESS_CA` (Canadian documents); fees and prices come from the live settings.
- **When you change the text:** bump `LEGAL_VERSION`, and add a migration that updates `legal_documents` to the same version (a test checks they match). Users are then asked to accept the new version at their next sign-in.
- Signed restaurant agreements: PDF generated by `src/lib/legal/agreement-pdf.ts`, downloadable in the restaurant's Kiosk tab.
- Have a licensed attorney (Washington, and Newfoundland and Labrador for Canada) review before launch.

---

## 15. Branding, text and images

- **Name:** "ResDish" (renamed from Bite Wise on 2026-10-16). Logo tagline "FOOD RESCUE"; slogan in emails and footers "Eat well · Waste less". Search with `git grep -n "ResDish"` / `git grep -n "Eat well"`.
- **Technical names that still say bitewise** (on purpose, nobody sees them, and changing them would log people out or break logins): the server service `bitewise`, the npm package name, the database job `bitewise-sweep`, browser storage keys `bitewise.*`, the local Supabase project id, staff login emails `@staff.bitewise.invalid`, demo accounts `@bitewise.test` and the demo password `BiteWise123`. The domain stays **bite-wise.org** until a new one is chosen.
- **Colors:** `src/app/globals.css` (orange `#ea580c`, green `#4e9f3d`, dark ink `#2a1a0e`). Three looks: customer (warm), restaurant (dark kitchen), admin (corporate). Chosen in `src/lib/theme.ts`.
- **Logos and icons:** `public/assets/` (`logo.svg` with tagline, `logo-compact.svg` without, `-dark` versions for dark backgrounds, `logo-mark.svg` the mascot alone, `logo.png` for PDFs, `email-logo.png` for emails, `app-icon-*` / `kiosk-icon-*` / `apple-touch-icon.png` for phones), plus `src/app/icon.svg` (browser tab) and `src/app/apple-icon.png`. The mark is the whole mascot (grocery bag, shoulder bag and feet). The dot of the "i" in "Dish" is a green leaf; in the website's SVG logos it drifts down and settles on the "i" once when the logo appears (skipped for visitors who turn off motion), and emails, PDFs and icons show it in place. All are made from the original artwork `assets/brand/resdish-logo-original.jpg` by `scripts/make-logo.py` (instructions at the top of the script; the leaf's size, colors and animation are in it too). Logo colors: radish red `#D63B4B`, teal `#13827C`. App install manifest: `src/app/app.webmanifest/route.ts`.
- **About us photos:** `public/about/` with the names shown on the page placeholders.
- **Demo food images:** `public/assets/demo-food/`.

---

## 16. Demo videos

- Videos: `public/videos/customer-tour.*` and `restaurant-tour.*` (mp4, webm, poster jpg, subtitles vtt). Shown on the home page, deals page ("How it works") and restaurant dashboard ("Watch the tour").
- **Version tag:** `src/components/app/demo-video-version.json` adds `?v=…` to the video links so browsers fetch new versions. Update it whenever videos change.
- **Service fee in the videos:** the recorder sets the demo data to a fixed **$1.99** per order before recording (`DEMO_SERVICE_FEE_CENTS` in `scripts/demo-video/record.mjs`, default 199).
- **Pronunciation:** the narrator says "ResDish" as "Rez dish" (`pronounce` in `scripts/demo-video/narration.json`).
- **Re-recording:** follow `scripts/demo-video/README.md` (narration text in `narration.json`, cartoon story in `story.html`, recording in `record.mjs`). It resets and seeds a local database first.

---

## 17. Business documents

| File | What |
|---|---|
| `docs/business/ResDish-Restaurant-Sales-Pitch.pptx` / `.pdf` | 10-slide sales pitch for restaurants, with speaker notes |
| `docs/business/ResDish-Restaurant-Partnership-Proposal.docx` / `.pdf` | Detailed partnership proposal. Its wording still uses the older "Founding Partner" name for Pioneer Members and describes greater Seattle only. |
| `docs/production/ResDish-Going-Live-Checklist.docx` / `.pdf` | Production go-live checklist |
| `docs/TROUBLESHOOTING-GUIDE.md` | This guide |
| `README.md` | Developer overview (some parts older than this guide; this guide wins if they disagree) |

---

## 18. Deploying changes

1. Make the change, then check it locally if you can: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
2. Commit and push to **`main`**. Vercel builds and deploys automatically (Vercel → Deployments shows progress; usually 1–3 minutes).
3. If the commit added a file under `supabase/migrations/`, run `npx supabase db push`.
4. If you changed an environment variable, **Redeploy** in Vercel.
5. Open the live site and check the change (hard-refresh with Ctrl+F5 / Cmd+Shift+R).

**If the live site doesn't change:** check Vercel → Deployments that the newest commit deployed and is "Ready". If it failed, open it to read the build error. If it never started, push again or click Redeploy.

---

## 19. Troubleshooting: symptom → fix

| Symptom | Likely cause | Fix |
|---|---|---|
| **No emails arrive** | `SMTP_HOST` not set in Vercel, or domain not verified in Resend | Set the SMTP variables ([section 4](#4-environment-variables-vercel-settings)), verify the domain in Resend, redeploy. Check Resend → Emails/Logs. |
| Emails rejected "domain not verified" | `EMAIL_FROM` isn't an `@bite-wise.org` address, or DNS records missing | Use `ResDish <no-reply@bite-wise.org>`; finish Resend DNS verification |
| Sign-up/confirm links go to the wrong site | `NEXT_PUBLIC_SITE_URL` or Supabase Site URL wrong | Set both to `https://www.bite-wise.org`; add `/auth/confirm` redirect in Supabase |
| "Card payments for this country aren't available yet" | That country's Stripe keys are missing | Add `STRIPE_SECRET_KEY(_CA)` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY(_CA)`, redeploy |
| Canadian customer asked for a "ZIP code" | Old version before the fix | Fixed: Canadian purchases show a Postal code box. Redeploy if still seen. |
| Postal code refused | Wrong format | Canada: `A1A 1A1` (the app formats it; the first 3 characters alone also work for customers). US: 5 digits. Code: `normalizePostal` in `src/lib/regions.ts` |
| Restaurant address shows the wrong state/province | Old version (used to say "WA") | Fixed; run `npx supabase db push` so deals return the province |
| Map pin / "Map" link goes to the wrong place | Address lookup failed or was wrong | Restaurant: Profile tab → **Find my address**, or drag the pin, then save. Admin/developer: `npm run locate-restaurants` |
| City/postal suggestions show Washington places | Old version | Fixed; run `npx supabase db push` (migration `20261022000300_areas_by_country.sql`) |
| Distances in the wrong unit | Customer's country on their account | US = miles, Canada = km, from the customer's country |
| Errors like "function … does not exist" / "column … does not exist" | Database missing the latest migrations | `npx supabase db push` |
| Live site shows old text/videos | Deployment didn't run, or browser cache | Check Vercel Deployments; hard-refresh; bump `demo-video-version.json` for videos |
| Plan renewals / no-show emails late | Vercel cron runs once a day | Expected on the Hobby plan; trigger `/api/cron/sweep` manually if needed |
| Restaurant can't post offers | Not approved, no plan, plan delinquent, or suspended | Admin → Restaurants / Plans; restaurant → Plan tab → Pay now |
| Restaurant's offers not visible to customers | Not approved, offer paused/ended/sold out, or wrong country | Admin → Restaurants (approve), Live offers |
| Customer can't log in | Email not confirmed, suspended, or banned | Admin → Customers (resend confirmation, reactivate, lift ban) |
| Wrong PIN locked | 15 wrong PINs in 10 minutes | Wait 10 minutes |
| Sales tax rate shows "state rate only, check it" | Exact lookup only for WA (or with Stripe Tax) | Admin → Restaurants → click the tax line to set the rate by hand |
| Admin can't see some restaurants/customers | Admin is in the other country | Each admin sees only their country; change it in Admin → Team |
| Kiosk link stopped working | A new link was generated | Restaurant → Kiosk tab → copy the current link |
| Restaurant can't set up Stripe payouts ("Payout setup isn't available yet" or "Stripe couldn't start your payout setup: …") | Stripe Connect isn't turned on, or its platform profile isn't finished, in that country's Stripe account (sandbox or live) | In Stripe (US or Canada account, same mode as the keys): **Connect → Get started**, choose Express accounts, finish **Settings → Connect → Platform profile**. Vercel → Logs shows Stripe's exact message ("Stripe onboarding for restaurant … failed"). Code: `connectOnboardingLink` in `src/lib/orders.ts` |
| Old demo restaurants show "MOCK BANK" / `acct_mock_…` | Practice payout accounts from test mode | Ignored once real Stripe keys are set; the restaurant connects a real account with **Continue Stripe setup** |
| Payouts not arriving | Restaurant hasn't connected Stripe, or Stripe account incomplete | Restaurant → Payouts tab → finish Stripe setup; Admin → Payouts for manual payouts |
| No "Order placed" email | Email not set up, or the hold never succeeded | Check the SMTP settings and Resend logs; the order's `placed_email_at` column shows if it was sent |
| Drive to Restaurant opens the wrong place | Restaurant's address is wrong | Directions use the typed address (not the map pin): fix it in the restaurant's Profile tab |
| "New order!" bell rings when handing over food | Fixed 2026-10-13 (the handover update was mistaken for a new order) | Redeploy if still seen; logic in `src/components/restaurant/dashboard.tsx` (Live order alerts) |
| Menu import finds nothing | Unusual website layout | Try the spreadsheet import, or set `ANTHROPIC_API_KEY` |

---

## 20. Common changes: step by step

**Change the support email:** Vercel → `SUPPORT_EMAIL` → redeploy. Then edit the hard-coded copies listed in [section 2](#example-where-is-supportbite-wiseorg), commit, push.

**Change the website address:** Vercel → Domains (add the domain) and `NEXT_PUBLIC_SITE_URL`; Supabase → Authentication → URL Configuration; Stripe webhooks (if set); redeploy. Search for the old address with `git grep`.

**Change the service fee, welcome bonus or fee tax:** Admin → Settings. No code.

**Change plan prices:** Admin → Plans → Change subscription fees (schedules the change and emails restaurants).

**Change sales tax rates for a state/province:** `src/lib/tax/states.ts` or `src/lib/tax/provinces.ts`; for one restaurant, Admin → Restaurants → its tax line.

**Add or change an email's wording:** `src/lib/email/templates.ts` (or `supabase/templates/confirmation.html` for sign-up).

**Change legal text:** see [section 14](#14-legal-documents) (bump the version + migration).

**Give someone admin access:** Admin → Team → add admin or employee (pick US or Canada; tick Refunds if needed).

**Turn on live payments:** see [section 10](#10-payments-stripe-us-and-canada), "Going live".

**Remove test accounts:** `npm run remove-test-data` (lists them), then `npm run remove-test-data -- --yes`.

---

## 21. Change log

Add a line for every change (newest first): date, what changed, and where.

| Date | Change | Where |
|---|---|---|
| 2026-10-17 | Fix: Stripe payout setup shows Stripe's real reason instead of "Something went wrong", and starts a new Stripe account when the saved one isn't in this Stripe account; videos show a $1.99 fixed service fee | `src/lib/orders.ts`, `scripts/demo-video/record.mjs`, `public/videos/` |
| 2026-10-16 | Logo: full mascot with its bags; green leaf as the dot of the "i", falling into place on the website; videos and documents updated | `scripts/make-logo.py`, `public/assets/`, `public/videos/`, `docs/business/`, `docs/production/` |
| 2026-10-16 | **Renamed Bite Wise → ResDish** everywhere (site, emails, receipts, PDFs, legal documents v2026-10-24.1, videos, business documents) with the new mascot logo; receipts `RD-`, plan invoices `RD-SUB-` | all files; migration `20261024000100_resdish_name.sql`; logos `public/assets/`, `scripts/make-logo.py` |
| 2026-10-13 | Fix: the new-order bell no longer rings when staff hand over an order | `src/components/restaurant/dashboard.tsx` |
| 2026-10-13 | Order placed email (hold receipt, PIN, Drive to Restaurant button); pickup email renamed Payment confirmed | `src/lib/email/templates.ts`, `src/lib/orders.ts`, `src/app/directions/[restaurantId]/route.ts`, `src/lib/regions.ts`, migration `20261023000100_order_placed_email.sql` |
| 2026-10-13 | Canadian legal documents and signed agreements show ResDish (St. John's, Newfoundland and Labrador) | `src/lib/env.ts` (`LEGAL_ADDRESS_CA`), `src/lib/legal/documents.ts`, `src/lib/legal/agreement-pdf.ts` |
| 2026-10-13 | Company address in legal documents: Federal Way, Washington (was Seattle) | `src/lib/env.ts` (`LEGAL_ADDRESS`), `.env.example` |
| 2026-10-13 | Created this guide | `docs/TROUBLESHOOTING-GUIDE.md` |
| 2026-10-13 | Support email `support@bite-wise.org`, website `www.bite-wise.org` | `src/lib/env.ts`, receipts, `supabase/templates/confirmation.html`, `.env.example`, sales deck |
| 2026-10-13 | Restaurant sales pitch deck (PowerPoint + PDF) | `docs/business/` |
| 2026-10-12 | Canadian purchases ask for a Postal code on the card form | `src/components/payments/card-entry.tsx`, `src/lib/env.ts` |
| 2026-10-12 | Addresses show the real state/province (not "WA"); Map link searches the full address; city/postal suggestions by country | `src/lib/regions.ts`, migrations `20261022000200`, `20261022000300` |
| 2026-10-12 | Distances in km for Canadian customers | `src/lib/format.ts`, offers components |
| 2026-10-12 | Postal code entry auto-formats; first 3 characters accepted | `src/lib/regions.ts` |
| 2026-10-12 | $10 welcome bonus; one combined Sales tax line | `src/lib/customer-welcome.ts`, `src/lib/service-fee.ts`, migration `20261022000100` |
| 2026-10-12 | Coupons with email templates | `src/lib/coupons.ts`, `src/components/admin/coupons.tsx`, migrations `20261021000100`, `20261021000200` |
| 2026-10-12 | Service fee taxed; fee tax by admin location (WA / NL) | migrations `20261020000200`, `20261020000300` |
| 2026-10-12 | Service fee as percentage or fixed amount | migration `20261020000100`, `src/lib/service-fee.ts` |
| 2026-10-12 | Charge by the restaurant's country (no card-country menu) | `src/lib/payments/index.ts`, `src/lib/env.ts` |
| 2026-10-11 | Canada: CAD payments through a separate Stripe account, postal codes | `src/lib/payments/`, migrations `20261018000100`, `20261019000100` |
| 2026-10-11 | Restaurants are paid the food and its sales tax; sold as is, courtesy refunds only | migrations `20261016000100`, `20261017000100` |
| 2026-10-10 | Service fees and subscription fees not refundable; light and dark mode | migration `20261015000100`, `src/app/globals.css` |
| Earlier | Everything before 2026-10-10 | see `git log` and the migration file names |
