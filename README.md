<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/assets/logo-dark.svg">
    <img src="public/assets/logo.svg" alt="Bite Wise" width="460">
  </picture>
</p>

# Bite Wise: Reduce Food Waste

Bite Wise is a marketplace, launching across the United States and Canada, where restaurants sell food that would otherwise be thrown away (wrong orders, delayed deliveries, orders nobody picked up, end-of-day surplus) at a discount they choose. Customers reserve it online, pay with a card hold, and pick it up with a 4-digit PIN. The card is charged only when the restaurant enters the PIN.

## Tech stack

| Area | What Bite Wise uses |
|---|---|
| **Framework** | Next.js 16 (App Router, Server Components, Server Actions, Route Handlers, `proxy.ts`), TypeScript (strict) |
| **Styling & UI** | Tailwind CSS v4, Lucide icons, shadcn-style primitives built on Radix UI (`src/components/ui`) |
| **Database & Auth** | Supabase: PostgreSQL with **PostGIS**, **Row Level Security** on every table, **Supabase Auth** (email + password; log in with email or user name), Supabase Storage for food photos, `pg_cron` for cleanup |
| **State & real-time** | TanStack Query for client data, **Supabase Realtime** channels (WebSockets) for the live offer feed, the restaurant's new-order bell and live order status |
| **Payments** | **Stripe Connect** (Express accounts): manual-capture card holds as destination charges with a **platform application fee**, transfers, reversals and refunds. A built-in mock processor runs when no Stripe keys are set |
| **Maps & location** | Leaflet with OpenStreetMap tiles, **PostGIS** spatial search (`ST_DWithin` / `ST_Distance` on `geography`), **haversine** distance in the browser, 186 Puget Sound ZIP codes |
| **Documents** | pdfkit: 80 mm point-of-sale receipts and landscape daily reports; CSV exports |
| **Tests** | Vitest: unit tests, integration tests against local Supabase (sign-up rules, RLS, checkout, pickup, refunds, payouts), Stripe request checks against `stripe-mock` |

## How it works

**Customers**
1. Sign up free with an **email, user name and password**, after reading and accepting the Customer Terms and Privacy Policy. **Declining creates no account.**
2. Browse deals as a **list** or on an **interactive map**, updated live. Search any city or ZIP code in King, Pierce, Thurston, Snohomish and Kitsap counties (Seattle, Des Moines, Kent, Federal Way, Tacoma, Fife, Olympia and more) or use your location, and filter by diet and distance.
3. Choose a quantity (never more than the restaurant made available) and see the total before ordering: **food price + 5% service fee + sales tax** (at the rate for the restaurant's address, looked up automatically).
4. Pay with a saved or new card, optionally using **Bite Wise platform credit** (the card covers the rest, at least $0.50).
5. A confetti screen shows the **4-digit PIN**. A hold is placed on the card; **it is charged only at pickup**. Cancel any time before pickup at no charge.
6. Every order has a **point-of-sale receipt** (web, print and PDF).

**Restaurants**
1. Sign up with the restaurant's details and accept the Restaurant Partner Agreement. New restaurants wait for owner approval (configurable).
2. Build a **menu with photos**, then post surplus food by picking a dish, a reason, a discount, a quantity and a **discard timer** (+30m / +1h to extend; pause, edit or end any time).
3. Keep the dashboard open: a **counter bell rings** and a pop-up appears the moment a customer orders (Supabase Realtime).
4. **Verify pickup:** type the customer's PIN, check the order, press **Hand over food & charge**. The card is captured, and the restaurant's food subtotal goes to its **Stripe account** automatically.
5. **Payouts tab:** connect Stripe (Express onboarding), see earnings and every transfer with its system-assigned **invoice number** and Stripe transaction ID.
6. **Daily report:** sales, meals rescued, discounts, tax and every order for any day, with print, PDF and CSV.

**Demo videos:** short narrated walkthroughs (the customer one includes an animated story of ordering, driving over and picking up; a friendly voice-over and upbeat background music, with optional subtitles) for customers and restaurants play on the home page ("See it in action"), behind **How it works** on the deals page and **Watch the tour** on the restaurant dashboard. They live in `public/videos/`; see `scripts/demo-video/README.md` to change the narration or re-record them.

**Counter kiosk:** every approved restaurant gets a private kiosk link for its counter tablet (see "Restaurant onboarding and the counter kiosk").

**Restaurant plans:** $15 a month or $150 a year (save $30), and the first 50 restaurants to choose a plan are **Pioneer Members**: free, with no card, and a $0.00 invoice every month or year that shows the plan price minus the Pioneer Members Discount. Restaurants can choose their plan as soon as their email is confirmed, while they wait for approval. Restaurants keep cards on file, paid plans renew automatically with the default card (restaurants can turn that off), a declined payment pauses their offers until paid, and the admin can change the fees any time — see "Restaurant plans and auto-renewal".

**Real emails only:** sign-up refuses disposable inboxes (Mailinator, 10-Minute Mail, Guerrilla Mail, ...), reserved test domains and domains that don't exist or take no email (checked with a DNS lookup of the domain's mail servers).

**Owner console (`/admin`)**: overview with revenue and a daily chart, **income** (Bite Wise's own earnings today, this month and this year, and for any date range by day, month or year, with a chart and income by restaurant; each table has its own CSV and PDF download, and a PDF button at the top downloads the whole tab, with its cards and chart, as one report), **alerts** (customers the platform suspended or banned for missed pickups), restaurant approvals, plans, suspensions (5–30 days, lifted automatically) and permanent bans, customers (suspend for 5, 10, 15, 20 or 30 days, lifted automatically; **ban permanently**: no login, open orders cancelled, the email can't sign up again; a ban can be lifted if it was a mistake; delete: accounts with order history are anonymized so sales and tax records stay intact; issue goodwill credit), orders (cancel, **refund by 10/25/50/75/100% or a set amount, to the original payment or as platform credit**, receipt PDF, CSV), live offer moderation (an offer with nothing left shows **Sold out**), payouts (send what's owed through Stripe or record a manual payout, with a locked invoice number and bank/transaction details), sales tax on orders and plan fees by location (CSV for the WA excise tax return), restaurant plans (subscription fees, Pioneer spots, delinquent plans), settings (service fee, starting tax rate, states where plan fees are taxed, approval) and an audit log of every admin action. **Downloads:** Restaurants, Customers, Orders, Payouts, Sales tax and the Audit log have **CSV** and **PDF** buttons on each table (with the tab's current filters and every row, not just the page on screen; CSVs open correctly in Excel); Payouts and Sales tax also have a PDF of the whole tab with its totals. Long lists show **25 rows a page** with Previous / Next, and a **Show 25 / 50 / 100 / 150 / 200 / All** picker (remembered in your browser).

## Money flow

| | Customer pays | Restaurant receives | Bite Wise keeps |
|---|---|---|---|
| **Normal order** | food + 5% fee + tax (charged at pickup) | the food subtotal (Stripe transfer at pickup) | service fee + sales tax (which it remits as marketplace facilitator) |
| **Paid partly with platform credit** | the rest by card | still the **full** food subtotal (Bite Wise tops up from its balance) | pays for the credit |
| **Refund to original payment** | money back to their card (credit part back to their balance) | gives up its share (the transfer is partially reversed) | gives up its fee share |
| **Refund as platform credit** | credit for future orders | keeps its full payment | pays for the credit |

With Stripe Connect, card holds are **destination charges** (`transfer_data.destination`) when the restaurant's Stripe account is ready. At capture Bite Wise sets an **application fee** (service fee + tax), so Stripe moves the food subtotal to the restaurant. Restaurants that haven't connected Stripe yet are charged on the platform and paid later from the owner console.

## Project layout

```
src/app/                 Pages (App Router), Server Actions (actions/), Route Handlers (api/)
src/components/          UI: ui/ primitives, app/ shell, offers/, orders/, restaurant/, admin/, receipts/
src/lib/                 Server & shared logic: supabase clients, auth, orders (checkout, pickup,
                         refunds, payouts), payments (Stripe Connect + mock), receipts (PDF/CSV),
                         admin data, legal documents, pricing, validation
src/proxy.ts             Session refresh and sign-in redirects (Next.js 16's replacement for middleware)
supabase/migrations/     Schema, RLS policies, business functions, ZIP data, storage/realtime/cron
scripts/                 seed.ts (demo data), create-admin.ts
tests/                   unit/ and integration/ (Vitest)
assets/pdf-fonts/        Fonts embedded in PDFs
legacy/                  The previous Express + SQLite version, kept for reference
```

### Security model

- **Reads go through Row Level Security.** Customers see only their own orders, cards and credit; restaurants see only their own menu, offers, orders and payouts; anyone can see live offers of approved restaurants. **Pickup PINs live in a separate table that only the customer can read**, so staff must type the PIN the customer shows.
- **Owners edit only safe columns** (column-level grants): a restaurant can change its address, never its tax rate or approval status; users can't change their role.
- **Money and order state change only inside Postgres functions** (`reserve_order`, `finish_pickup`, `apply_refund`, `record_payout`, ...). Those are callable only by the server's secret key, after the server has checked who is asking. Offers are locked while reserving, so the last item can never be sold twice.
- **Sign-up is enforced by a database trigger:** the account is created only if the current version of every required legal document was accepted, and sign-up can never create an admin.
- Wrong PINs are rate-limited (15 per 10 minutes per restaurant); uploads are checked by file signature; Stripe webhooks are signature-verified; the cron route needs a bearer secret.

## Run it locally

Requirements: Node.js 20.9+ and a Supabase database. Use a free project on supabase.com (nothing else to install) or run Supabase on your computer with Docker.

### Option A: free Supabase project (no Docker)

1. **Create the project.** Sign up at [supabase.com](https://supabase.com) and click **New project**. Choose a name, a database password (keep it) and the region nearest you. When it's ready, open **Database → Extensions** and turn on **pg_cron** (the app's every-minute cleanup).
2. **Create the tables.** In a terminal (PowerShell on Windows) in the app folder:

   ```bash
   npm install
   npx supabase login                               # opens your browser to sign in
   npx supabase link --project-ref YOUR_PROJECT_REF # asks for the database password from step 1
   npx supabase db push                             # applies supabase/migrations
   ```

   `YOUR_PROJECT_REF` is the ID in the project's dashboard address: `https://supabase.com/dashboard/project/<ref>`.
3. **Fill in `.env.local`.** Copy `.env.example` to `.env.local` (`copy .env.example .env.local` in PowerShell, `cp` elsewhere) and set these from **Project Settings → API Keys** and the project URL:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   SUPABASE_SECRET_KEY=sb_secret_...
   ```

   Leave the Stripe keys empty to use the built-in test payments: cards and payouts are simulated, restaurants "connect" a practice account with a test bank instantly, and there is no Stripe dashboard (the Payouts tabs say so). To go live, turn on **Connect** (Express accounts) in Stripe, set `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET`, and restart; restaurants then connect their real Stripe accounts (practice connections don't carry over). Keep the secret key private; `.env.local` is never committed.
4. **Send login emails back to your computer.** In **Authentication → URL Configuration**, set **Site URL** to `http://localhost:3000` and add `http://localhost:3000/auth/confirm` to **Redirect URLs**.
5. **Load demo data and start:**

   ```bash
   npm run seed              # demo accounts, menus, live offers and two weeks of orders
   npm run dev               # http://localhost:3000
   ```

When an update adds files to `supabase/migrations`, run `npx supabase db push` again.

### Option B: Supabase on your computer (needs Docker)

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) (on Windows, with WSL 2) and keep it running, then:

```bash
npm install
npm run db:start          # starts Supabase locally (Postgres/PostGIS, Auth, Realtime, Storage) and applies migrations
cp .env.example .env.local   # then paste the URL, publishable key and secret key printed by db:start
npm run seed              # demo accounts, menus, live offers and two weeks of orders
npm run dev               # http://localhost:3000
```

`npm run db:start` fails with "docker: command not found" if Docker isn't installed or running; use Option A instead. The integration tests (`npm test`) and `npm run db:reset` need this local setup. When `.env.local` points at a hosted project on supabase.com, `npm test` runs only the unit tests and skips the integration tests, because they create throwaway users and orders.

### Using the app

Opening the app through a tunnel or proxy (e.g. VS Code port forwarding, `*.devtunnels.ms`)? Add `TRUSTED_ORIGINS=*.devtunnels.ms,localhost:3000` to `.env.local` and restart (rebuild first if you use `npm start`); otherwise Next.js blocks log-in and other forms as cross-site requests.

Demo logins (password `BiteWise123`): customer `demo`, owner `admin`, restaurants `harborpho`, `ballardbread`, `caphilltacos`, `fremontpizza`, `bellevuecurry`, `redmondpoke`, `kirklandsushi` (Stripe connected) and 22 more around the region (`tacomathai`, `olympiacafe`, `desmoinesfish`, ...). Test cards (mock mode): `4242 4242 4242 4242` works; `4000 0000 0000 0002` is declined.

Create your real owner account (admins can't sign up on the website):

```bash
npm run create-admin -- --email you@yourcompany.com --username owner
```

**Test accounts:** the integration tests create throwaway accounts (`t_xxxxxxxx@example.com`, restaurants called "Test Kitchen t_xxxxxxxx") in the local database and remove them when they finish. If any ended up in a database (for example from running the tests against a hosted project before they refused to), `npm run remove-test-data` lists them and `npm run remove-test-data -- --yes` deletes them with their orders, offers and payouts. Demo (`@bitewise.test`) and real accounts are never touched.

Other commands: `npm run lint`, `npm run typecheck`, `npm test` (unit + integration; integration tests need `db:start`, and the Stripe checks need `docker run -d -p 12111:12111 stripe/stripe-mock`), `npm run db:reset` (fresh database), `npm run db:types` (regenerate `src/lib/database.types.ts` after changing migrations), `npm run build`.

## Keep it running on your own server (systemd)

`npm start` stops when the terminal that started it closes (for example when you close VS Code). On a Linux server, install Bite Wise as a **systemd service** instead: it keeps running after you log out, restarts itself if it crashes, and starts when the server boots.

**One-time setup** (from the app folder, as your normal user, with `.env.local` filled in):

```bash
npm run service:install        # asks for your sudo password; builds the app the first time
sudo systemctl start bitewise
```

The installer uses your user account and your Node.js (nvm works), and serves on port 3000. Change it with `npm run service:install -- --port 8080`; running the installer again updates the service.

| To... | Run |
|---|---|
| Start / stop / restart | `sudo systemctl start bitewise` / `stop` / `restart` |
| See if it's running | `systemctl status bitewise` |
| Follow the logs | `sudo journalctl -u bitewise -f` |
| Turn off starting at boot | `sudo systemctl disable bitewise` |
| **Deploy the latest code** | `npm run update` |

**`npm run update`** pulls the latest code, runs `npm ci` if packages changed, and builds the new version **while the site keeps running**. Then it swaps the new build in and restarts, so the site is down for about a second. If the new version doesn't answer, the previous one is put back automatically. If nothing new was pushed, it says so and does nothing. When an update includes database migrations, it reminds you to run `npx supabase db push`.

**Upgrading a server from before the rename to Bite Wise** (when the service was called `rescuebites` or `biteback`): run `npm run update` twice. The first run deploys the new code on the old service; the second replaces the old service with `bitewise`, keeping its port and settings (or run `npm run service:install` once to switch straight away). Then run `npx supabase db push`, which also renames the database's cleanup job, and `npm run seed` if the server has the demo data: it moves the demo accounts to `@bitewise.test` emails and the `BiteWise123` password. In `.env.local`, change `LEGAL_ENTITY_NAME` and `SUPPORT_EMAIL` if they still have an old name.

Don't run `npm start` or `npm run build` in the same folder while the service is running: that would replace the build it is serving. Use `npm run dev` for development, `npm run update` to deploy.

### On Windows (or any computer without the service)

systemd is Linux-only, so `npm run service:install` just explains this on Windows and macOS. Run the app with `npm run build` and then `npm start`. To update it:

1. Stop the app: press **Ctrl+C** in the window running `npm start`.
2. Run `npm run update`. It pulls the latest code, installs packages if they changed, and builds. It stops with a message if the app is still running, and says so if the latest code is already built. Use `npm run update -- --force` to rebuild anyway, or `-- --no-pull` to build the code already in the folder.
3. If it mentions database changes, run `npx supabase db push`.
4. Start the app again with `npm start`.

To keep the app running in the background on Windows instead, use WSL 2 with systemd turned on, or run it on a Linux server or VM.

## Deploy

1. **Supabase:** create a project, then `npx supabase link --project-ref <ref>` and `npx supabase db push` to apply the migrations. In Auth settings, set the Site URL, add `https://<your-site>/auth/confirm` as a redirect URL, and turn on **Confirm email**. Enable the `pg_cron` extension (Database → Extensions) before pushing, or schedule `/api/cron/sweep` instead.
2. **Stripe:** turn on Connect (Express accounts). Add a webhook endpoint `https://<your-site>/api/stripe/webhook` for `account.updated` (connected accounts), `payment_intent.amount_capturable_updated` and `payment_intent.payment_failed`.
3. **Vercel (or any Node host):** set the variables from `.env.example` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SITE_URL`, Stripe keys, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, company details). `vercel.json` calls `/api/cron/sweep` every 5 minutes, which voids card holds of released orders and renews restaurant plans (a long-running Node server does this by itself).
4. Create your owner account with `npm run create-admin` (pointing `.env.local` at the production project).

Use a commercial map tile provider in production (`NEXT_PUBLIC_MAP_TILE_URL`). OpenStreetMap's public tiles are for light use only.

## Branded emails

**The app sends the "confirm your email" message itself** whenever it can send email (`SMTP_HOST` etc. in `.env.local`, the same account as below) and **Confirm email** is on in Supabase (Authentication → Sign In / Providers → Email). It uses the Bite Wise design in `supabase/templates/confirmation.html` (logo, a welcome with the user's name, different wording for customers and restaurants) straight from the code, so whatever template is stored in Supabase is never used: Supabase only creates the account and the one-time confirmation link. The **Resend confirmation email** button works the same way. If the app can't send email (no SMTP settings, or the send fails), Supabase sends its own stored template instead. The local stack (`npm run db:start`) has Confirm email off, so sign-up logs straight in.

**Supabase's stored copy (fallback only):** `npm run email:template` installs the same design in your supabase.com project, so even Supabase's own email is branded. It uploads the logo to a public `brand` storage bucket (email apps need a public web address for images), then sets the **Confirm signup** email's subject and body, and the sender name **Bite Wise**, through the Supabase Management API. That needs a personal access token: create one at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) and add `SUPABASE_ACCESS_TOKEN=...` to `.env.local` (or the script uses the one `npx supabase login` saved). Without a token, the script writes `confirm-signup-email.html` and tells you where to paste it (**Authentication → Emails → Confirm signup**, source view). Free Supabase projects can only change their stored design after connecting their own email provider.

**Invoices by email, the moment a payment is made:**
- **Customers:** when the restaurant hands over the food (and the card is charged), the customer gets an invoice email listing the item, the original price, the Bite Wise discount, the service fee, sales tax, the total and how it was paid (card and/or credit), with the **PDF receipt attached** and a link to the receipt page.
- **Restaurants:** every plan payment (new plan, renewal, **Pay now**, an admin's **Charge default card**) and every Pioneer Member's free period gets an invoice email with the **PDF invoice attached** (plan price, any discount such as the Pioneer Members Discount, total) and a **View my invoice** link to `/restaurant/invoices/[id]`.

Set `NEXT_PUBLIC_SITE_URL` (and **Authentication → URL Configuration → Site URL**, for Supabase's fallback email) to your site's address: the button links to `<site>/auth/confirm`. After signing up, people see a "Check your email" page with **Resend confirmation email** (once a minute) and **Back to login**; trying to log in before confirming offers the resend button too.

**Sending to real customers:** Supabase's built-in email service is only for testing. It sends a few emails an hour, and only to your project team's addresses. Before launch, connect your own email provider in **Authentication → Emails → SMTP Settings** (for example Resend, Postmark or Amazon SES), with a sender like `Bite Wise <hello@your-domain>`, and put the same account in `.env.local` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`) for the emails the app sends.

## About us page

`/about` tells the founders' story (linked in the header and footer). Photo spots show a placeholder until a photo is added to `public/about/` with the name shown in the placeholder (`founders`, `pakistan`, `family-meal`, `childhood`, `family`, `umer`, `arham`, `shaheer`, `aini`, `ulliya`; .jpg, .png or .webp; portrait 4:5 looks best). Then run `npm run update` (Next.js only serves files that were in `public/` when the site was built). The text is in `src/app/about/page.tsx`.

## Restaurant onboarding and the counter kiosk

A restaurant that signs up gets three emails:

1. **Confirm your email** (the branded email above).
2. **Application pending**, as soon as the email is confirmed, while it waits for approval in the owner console.
3. **Welcome**, when an admin approves it (or, if the owner hasn't confirmed their email yet, as soon as they do; the Restaurants tab shows **Email not confirmed** with a **Resend confirmation** button, says after approving whether the welcome email went out and why not, and has **Send welcome email** to send it again): its **electronically signed Restaurant Partner Agreement** as a PDF (the full text plus a signature record: who accepted, when, IP address, device, document version and SHA-256 fingerprint, and Bite Wise's acceptance on approval), and its **kiosk link** with buttons for Android tablets and iPads.

Emails 2 and 3 are sent by the app through the SMTP account in `.env.local` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`; the same Gmail app password as Supabase works). Each is sent once (`restaurant_onboarding`); without SMTP they are only logged, and go out on the next event once SMTP is set. If approval is turned off in Settings, restaurants get the welcome email right after confirming.

**The kiosk** (`/kiosk/<secret>`) is a full-screen page for the restaurant's counter tablet: orders awaiting pickup (polled every 5 seconds, with the bell for new ones) and a large PIN pad to hand them over. There is no login; the long random link is the kiosk's key and only works for that restaurant's orders, with the same wrong-PIN lock as the dashboard. Each kiosk has its own web app manifest, so it can be added to the tablet's home screen and opens full-screen:

- **Android (Chrome):** the kiosk's **Add to home screen** button opens Chrome's install prompt (one tap to confirm).
- **iPad / iPhone (Safari):** Apple doesn't let websites add home-screen icons themselves, so the kiosk shows the steps (Share → Add to Home Screen → Add).
- **Windows computer (Edge or Chrome):** the kiosk offers **Install on this computer** (Edge: menu → Apps → Install this site as an app; Chrome: the install icon in the address bar). The **Bite Wise Kiosk** app then opens in its own window from the Start menu or desktop, and can be pinned to the taskbar or started at login.

No website or email can put an icon on a home screen without the person confirming it. The welcome email's buttons open the kiosk with the right guide for each device.

Restaurants find their link, a QR code to open it on the tablet, and a **Get a new link** button (the old link stops working at once) in the dashboard's **Kiosk** tab, along with **Download signed agreement (PDF)**.

## Restaurant plans and auto-renewal

An approved restaurant needs a plan to post offers. It chooses one in the dashboard's **Plan** tab; a restaurant still waiting for approval sees a banner inviting it to choose its plan straight away:

| Plan | Price | Notes |
|---|---|---|
| **Pioneer Member** | free | The first 50 restaurants to choose a plan (setting `founding_spots`), monthly or annual, even before approval. No card is asked for; a congratulations message confirms the plan is FREE. Every month or year they get an invoice (`/restaurant/invoices/[id]`, also emailed) listing the plan price, minus the **Pioneer Members Discount**, for a total of **$0.00**. They can switch between monthly and annual and stay free. |
| **Monthly** | $15 / month + sales tax | Paid in advance. |
| **Annual** | $150 / year + sales tax | Paid in advance; $30 less than 12 months. |

**Three looks:** customers get a warm, light design (cream, orange and green); the restaurant portal and kiosk a dark kitchen dashboard (charcoal and amber, big buttons, a menu down the left); the owner console a light corporate console (slate, navy sidebar, blue). The address picks the look (`src/lib/theme.ts`, set in `src/proxy.ts`); the colors are tokens in `src/app/globals.css`, so every component follows the theme.

**Accounts and log-in:** customers, restaurant owners and restaurant staff log in at `/login`, with a **Log in as a customer / Log in as a restaurant** slider (the wrong side says so and offers to switch); the admin team logs in at `/admin/login`. Sign-up at `/signup` has the same **I'm a customer / I'm a restaurant** slider (`?role=restaurant` or `/restaurant/signup` open the restaurant side). Switching sides switches the page's look. **Remember me** keeps the user name in the browser and asks the browser's password manager to save the password (Bite Wise never stores passwords itself). **Forgot password:** the user enters their email, gets a 6-digit code by email (valid 1 hour, 5 wrong tries, one code a minute) and sets a new password, typed twice. Everyone signed in is **logged out after 10 minutes without activity** (with a one-minute warning; shared across tabs); the restaurant kiosk is not affected. A customer gets a **welcome email** once they confirm their email, with buttons to put Bite Wise on an **Android phone, iPhone or Windows** computer (the `/app` install guide; Windows Phone is discontinued).

**Restaurant staff:** owners add managers and supervisors in the **Staff** tab with a user name and password. Staff log in on the partner page and can verify pickups, post and manage offers, add menu items and change prices, and import the menu; they don't see payouts, plan and billing, sales amounts, reports, the kiosk link, the profile or the Staff tab (database rules enforce this, not just the screens). Owners can pause, reset the password of or delete a staff account; staff of a banned or deleted restaurant can't log in.

**Menu import** (restaurants and admins): from the restaurant's website (schema.org menus, menu items laid out on the page, menus the page embeds or links to, and menus built with JavaScript, which are opened in a hidden Chromium; with `ANTHROPIC_API_KEY`, Claude reads harder layouts and menus that are pictures) or from a spreadsheet (CSV file or cells pasted from Excel / Google Sheets: Name, Price, Description, Photo, Dietary). Everything found is shown for review and editing first; photos are copied into Bite Wise. Pages are fetched safely (no internal addresses, size and time limits).

**Admin team:** in the owner console's **Team** tab, admins add more **admins** (full access) or **employees**. Employees log in at `/admin/login` and see only Alerts, Restaurants, Customers, Orders and Live offers: they can approve, suspend, ban and reactivate accounts, update emails and details, resend emails and end offers, but can't delete accounts, change tax rates or see income, plans, payouts, sales tax, settings or the audit log. Refunds and credit are available only to employees an admin ticks **Refunds** for. The server checks every permission (`requireAdmin` in `src/lib/auth.ts`), not just the screens; a new team member gets a welcome email (never with the password).

**Admin edits:** in the owner console, admins can correct a customer's email address and user name, or a restaurant's details and its owner's email and user name, and then send the welcome email again.

**Automatic sales tax rates** (`src/lib/tax`, `src/lib/restaurant-tax.ts`): customers always pick up at the restaurant, so the sale happens at the restaurant's address and that address sets the rate (state + county + city + special districts). Restaurants enter their state with their address and can't type a rate. The rate is looked up when a restaurant signs up or changes its address, and again every 30 days by the scheduled jobs: **Stripe Tax** first when `STRIPE_TAX=on` (any US address, prepared-food rate, only in states where you've added a tax registration in Stripe), then the **WA Department of Revenue** address lookup (free) for Washington, and otherwise the state's own meals rate as an estimate, flagged *"state rate only, check it"* in the admin Restaurants tab. If a lookup service is down the current rate is kept and retried the next day. An admin can click a restaurant's tax line to look it up again or set a rate by hand (a hand-set rate is never changed by the app). Each order and plan payment records the rate and where it applies (`tax_jurisdiction`), so later changes never alter past receipts.

**Sales tax on plans:** in the states listed in the admin setting *States where plan fees are taxed* (WA to start), sales tax is added to every plan payment at the restaurant's own rate (its `tax_rate_bps`, the same rate as its food sales; 10.35% in Seattle), so $15.00 is charged as $16.55. Checkout, invoices (web, PDF and email), renewal reminders and the billing history show the tax separately. Pioneer Members' $0.00 invoices have no tax. The **Sales tax** tab lists it next to the tax on food orders.

**Changing the fees:** owner console → **Plans** tab → *Change subscription fees*. Enter the new monthly and annual fees and the date they take effect (at **12:01 AM Pacific Time**), and choose who pays them:
- **Keep existing restaurants at their current fees:** restaurants with a plan keep paying what they pay now (their price is locked when the change takes effect); only plans started from that date pay the new fees.
- **Existing restaurants also pay the new fees:** from their first renewal on or after that date (this also ends any earlier lock).

Pick the email that announces it from the templates (*Rising operating costs*, *New features and improvements*, *Annual price review*, *Introductory pricing ends*), edit it, save your own templates, **Preview** it as a restaurant will see it, and **Schedule & send**: every restaurant is emailed straight away, with a sentence about what the change means for its own plan (`{{your_plan}}`). Pioneer Members are only emailed if you tick the box (fee changes never apply to them). One change can be scheduled at a time and cancelled before it takes effect; the tab keeps a history. The agreement promises 30 days' notice, and the form warns about shorter dates. *Plan settings* has the number of Pioneer spots and when renewal reminders go out. The tab also shows monthly recurring revenue, every restaurant's plan (delinquent ones first) and a **Charge default card** button for delinquent plans. Every change is in the audit log.

**Emails restaurants get about their plan:** a receipt for every payment; a **renewal reminder** 30 days before an annual plan renews and 7 days before a monthly one (both adjustable), saying the card on file will be charged this amount on this date; a **delinquent** notice when a payment is declined (offers paused, no new offers until the payment is made, with the renewal link); and fee-change announcements.

**Cards on file:** restaurants keep one or more cards on file in the Plan tab (Stripe SetupIntents, or the mock processor without Stripe keys) and choose a **default** card. A plan is paid with a saved card or a new one (which is saved), and **auto-renewal charges the default card** at the end of each period, with an invoice number (`BW-SUB-000001`) and an emailed receipt. Auto-renewal is on by default and can be turned off any time (the plan then ends at the end of the paid period); the last card of an auto-renewing plan can't be removed. Restaurants can switch between monthly and annual from their next renewal, and annual plans get a reminder email a week before renewing.

**Declined payments make the plan delinquent at once:** its live offers are paused and it can't post or turn on offers until a payment succeeds. The restaurant is emailed and sees a red **Pay now** banner; it can pay with any saved or new card, and its new period starts on the day it pays. The default card is also retried automatically once a day for 7 days. A delinquent plan never lapses by itself: it stays delinquent until it is paid.

Renewals are charged by the app's **scheduled jobs**, which also void card holds. A long-running server (`npm start` or the Linux service) runs them by itself every 5 minutes (`src/instrumentation.ts`). On Vercel, `vercel.json` calls `/api/cron/sweep` instead (set `CRON_SECRET`).

Restaurants that were Founding Partners become free monthly Pioneer Members. Paid plans start once a restaurant is approved; Pioneer spots can be taken before. `npm run seed` puts the approved demo restaurants on paid plans with a test card on file (they never use Pioneer spots).

## Map positions and phone numbers

**Map positions:** when a restaurant signs up or saves its profile, its street address is looked up (US Census Bureau geocoder, then OpenStreetMap Nominatim; free, no key) so its offers show at the restaurant, not at the middle of its ZIP code. A match more than 25 miles from the ZIP code is ignored. The Profile tab has a **Find my address** button. Restaurants added before this were placed at their ZIP code: `npm run locate-restaurants` lists the new positions it finds and `npm run locate-restaurants -- --yes` saves them (`--all` re-checks every restaurant). Set `GEOCODING=off` to turn lookups off (the ZIP code is used).

**Phone numbers** are typed as digits and formatted as you type to `(xxx) xxx-xxxx`; they are stored and shown (receipts, reports, invoices, agreements) the same way.

## Suspensions and bans

| | Customer | Restaurant |
|---|---|---|
| **Suspend** (5, 10, 15, 20 or 30 days) | can't log in; lifted automatically | offers hidden, can't post; staff can still hand over orders already placed; lifted automatically |
| **Ban** (permanent) | can't log in, open orders cancelled (not charged), email can't sign up again | removed from the site: offers end, open orders cancelled, kiosk link stops working, owner banned too |

**Missed pickups (automatic):** an order that isn't picked up or cancelled before its discard timer ends is a missed pickup (the food is wasted). The platform counts each customer's missed pickups in a row (a pickup resets the count; cancelled orders never count) and acts by itself:
- **3 in a row:** the account is **suspended for 30 days** (login blocked, open orders cancelled) and **reactivated automatically** when the 30 days are over.
- **After that suspension, the first missed pickup bans the account permanently.**
- The customer is emailed after every missed pickup (how many in a row, what happens next) and when suspended or banned. **Every admin is emailed** for each suspension and ban, and it shows in the owner console's **Alerts** tab (with a red count on the tab). The Customers tab shows missed pickups in a row and "final warning" for accounts that were suspended before.
- Reactivating a customer or lifting a ban in the Customers tab clears their missed-pickup record (a fresh start). The limits are the settings `no_show_limit` (3) and `no_show_suspension_days` (30). The rules are in the Customer Terms, section 5.4.

**Delete** (Customers and Restaurants tabs) closes an account for good: open orders are cancelled first, and a restaurant is taken off the site with its owner's account. Accounts and restaurants with no history are removed completely; ones with sales, payouts or plan payments keep those records for tax reporting, with the person's name, email and cards erased (deleted restaurants show under the **Deleted** status filter).

Suspensions and bans are in the owner console (**Customers** and **Restaurants** tabs), need the name typed to confirm a ban, and are written to the audit log. **Lift ban** undoes a ban made by mistake. Sales, payout and tax records are always kept.

## Legal documents

Customer Terms, Restaurant Partner Agreement and Privacy Policy live in `src/lib/legal/documents.ts` (version `2026-10-09.1`, which added the restaurant subscription fees, renewal reminders, fee-change notices, delinquent plans and permanent bans) and are shown at `/legal/...`. When you change the text, bump `LEGAL_VERSION` and add a migration updating `legal_documents`; a test checks they match. Signed-in users are then asked to accept the new version (declining signs them out). Have a Washington-licensed attorney review them before launch.

## Upgrading from the first version

The original Express + SQLite app is in `legacy/` for reference. Its demo data isn't migrated: run `npm run seed` for fresh demo data. Everyone accepts the updated terms (new version) on first sign-in. 
