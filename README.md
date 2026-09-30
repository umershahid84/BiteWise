<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/assets/logo-dark.svg">
    <img src="public/assets/logo.svg" alt="Rescue Bites" width="460">
  </picture>
</p>

# Rescue Bites: Reduce Food Waste

Rescue Bites is a marketplace where restaurants in greater Seattle sell food that would otherwise be thrown away (wrong orders, delayed deliveries, orders nobody picked up, end-of-day surplus) at a discount they choose. Customers reserve it online, pay with a card hold, and pick it up with a 4-digit PIN. The card is charged only when the restaurant enters the PIN.

## Tech stack

| Area | What Rescue Bites uses |
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
3. Choose a quantity (never more than the restaurant made available) and see the total before ordering: **food price + 5% service fee + WA sales tax**.
4. Pay with a saved or new card, optionally using **Rescue Bites platform credit** (the card covers the rest, at least $0.50).
5. A confetti screen shows the **4-digit PIN**. A hold is placed on the card; **it is charged only at pickup**. Cancel any time before pickup at no charge.
6. Every order has a **point-of-sale receipt** (web, print and PDF).

**Restaurants**
1. Sign up with the restaurant's details and accept the Restaurant Partner Agreement. New restaurants wait for owner approval (configurable).
2. Build a **menu with photos**, then post surplus food by picking a dish, a reason, a discount, a quantity and a **discard timer** (+30m / +1h to extend; pause, edit or end any time).
3. Keep the dashboard open: a **counter bell rings** and a pop-up appears the moment a customer orders (Supabase Realtime).
4. **Verify pickup:** type the customer's PIN, check the order, press **Hand over food & charge**. The card is captured, and the restaurant's food subtotal goes to its **Stripe account** automatically.
5. **Payouts tab:** connect Stripe (Express onboarding), see earnings and every transfer with its system-assigned **invoice number** and Stripe transaction ID.
6. **Daily report:** sales, meals rescued, discounts, tax and every order for any day, with print, PDF and CSV.

**Demo videos:** short narrated walkthroughs (a friendly voice-over and upbeat background music, with optional subtitles) for customers and restaurants play on the home page ("See it in action"), behind **How it works** on the deals page and **Watch the tour** on the restaurant dashboard. They live in `public/videos/`; see `scripts/demo-video/README.md` to change the narration or re-record them.

**Owner console (`/admin`)**: overview with revenue and a daily chart, restaurant approvals and suspensions, customers (suspend for 5, 10, 15, 20 or 30 days, lifted automatically; delete: accounts with order history are anonymized so sales and tax records stay intact; issue goodwill credit), orders (cancel, **refund by 10/25/50/75/100% or a set amount, to the original payment or as platform credit**, receipt PDF, CSV), live offer moderation, payouts (send what's owed through Stripe or record a manual payout, with a locked invoice number and bank/transaction details), sales tax by location (CSV for the WA excise tax return), settings (service fee, default tax, approval) and an audit log of every admin action.

## Money flow

| | Customer pays | Restaurant receives | Rescue Bites keeps |
|---|---|---|---|
| **Normal order** | food + 5% fee + tax (charged at pickup) | the food subtotal (Stripe transfer at pickup) | service fee + sales tax (which it remits as marketplace facilitator) |
| **Paid partly with platform credit** | the rest by card | still the **full** food subtotal (Rescue Bites tops up from its balance) | pays for the credit |
| **Refund to original payment** | money back to their card (credit part back to their balance) | gives up its share (the transfer is partially reversed) | gives up its fee share |
| **Refund as platform credit** | credit for future orders | keeps its full payment | pays for the credit |

With Stripe Connect, card holds are **destination charges** (`transfer_data.destination`) when the restaurant's Stripe account is ready. At capture Rescue Bites sets an **application fee** (service fee + tax), so Stripe moves the food subtotal to the restaurant. Restaurants that haven't connected Stripe yet are charged on the platform and paid later from the owner console.

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
- **Owners edit only safe columns** (column-level grants): a restaurant can change its address or tax rate, never its approval status; users can't change their role.
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

   Leave the Stripe keys empty to use the built-in test payments. Keep the secret key private; `.env.local` is never committed.
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

`npm run db:start` fails with "docker: command not found" if Docker isn't installed or running; use Option A instead. The integration tests (`npm test`) and `npm run db:reset` need this local setup.

### Using the app

Opening the app through a tunnel or proxy (e.g. VS Code port forwarding, `*.devtunnels.ms`)? Add `TRUSTED_ORIGINS=*.devtunnels.ms,localhost:3000` to `.env.local` and restart (rebuild first if you use `npm start`); otherwise Next.js blocks log-in and other forms as cross-site requests.

Demo logins (password `RescueBites123`): customer `demo`, owner `admin`, restaurants `harborpho`, `ballardbread`, `caphilltacos`, `fremontpizza`, `bellevuecurry`, `redmondpoke`, `kirklandsushi` (Stripe connected) and 22 more around the region (`tacomathai`, `olympiacafe`, `desmoinesfish`, ...). Test cards (mock mode): `4242 4242 4242 4242` works; `4000 0000 0000 0002` is declined.

Create your real owner account (admins can't sign up on the website):

```bash
npm run create-admin -- --email you@yourcompany.com --username owner
```

Other commands: `npm run lint`, `npm run typecheck`, `npm test` (unit + integration; integration tests need `db:start`, and the Stripe checks need `docker run -d -p 12111:12111 stripe/stripe-mock`), `npm run db:reset` (fresh database), `npm run db:types` (regenerate `src/lib/database.types.ts` after changing migrations), `npm run build`.

## Keep it running on your own server (systemd)

`npm start` stops when the terminal that started it closes (for example when you close VS Code). On a Linux server, install Rescue Bites as a **systemd service** instead: it keeps running after you log out, restarts itself if it crashes, and starts when the server boots.

**One-time setup** (from the app folder, as your normal user, with `.env.local` filled in):

```bash
npm run service:install        # asks for your sudo password; builds the app the first time
sudo systemctl start rescuebites
```

The installer uses your user account and your Node.js (nvm works), and serves on port 3000. Change it with `npm run service:install -- --port 8080`; running the installer again updates the service.

| To... | Run |
|---|---|
| Start / stop / restart | `sudo systemctl start rescuebites` / `stop` / `restart` |
| See if it's running | `systemctl status rescuebites` |
| Follow the logs | `sudo journalctl -u rescuebites -f` |
| Turn off starting at boot | `sudo systemctl disable rescuebites` |
| **Deploy the latest code** | `npm run update` |

**`npm run update`** pulls the latest code, runs `npm ci` if packages changed, and builds the new version **while the site keeps running**. Then it swaps the new build in and restarts, so the site is down for about a second. If the new version doesn't answer, the previous one is put back automatically. If nothing new was pushed, it says so and does nothing. When an update includes database migrations, it reminds you to run `npx supabase db push`.

**Upgrading a server from before the rename to Rescue Bites** (when the service was called `biteback`): run `npm run update` twice. The first run deploys the new code on the old service; the second replaces the `biteback` service with `rescuebites`, keeping its port and settings (or run `npm run service:install` once to switch straight away). Then run `npx supabase db push`, which also renames the database's cleanup job, and `npm run seed` if the server has the demo data: it moves the demo accounts to `@rescuebites.test` emails and the `RescueBites123` password. In `.env.local`, change `LEGAL_ENTITY_NAME` and `SUPPORT_EMAIL` if they still say BiteBack.

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
3. **Vercel (or any Node host):** set the variables from `.env.example` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SITE_URL`, Stripe keys, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, company details). `vercel.json` calls `/api/cron/sweep` every 5 minutes, which voids card holds of released orders.
4. Create your owner account with `npm run create-admin` (pointing `.env.local` at the production project).

Use a commercial map tile provider in production (`NEXT_PUBLIC_MAP_TILE_URL`). OpenStreetMap's public tiles are for light use only.

## Branded emails

The "confirm your email" message sent after sign-up comes from **Supabase Auth**, not from the app. Rescue Bites replaces Supabase's plain default with a branded one: `supabase/templates/confirmation.html` (logo, a welcome with the user's name, and different wording for customers and restaurants). The local stack (`npm run db:start`) uses it automatically through `supabase/config.toml`.

For a project on supabase.com, install it with `npm run email:template`. It uploads the logo to a public `brand` storage bucket in your project (email apps need a public web address for images), then sets the **Confirm signup** email's subject and body through the Supabase Management API. That needs a personal access token: create one at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) and add `SUPABASE_ACCESS_TOKEN=...` to `.env.local` (or the script uses the one `npx supabase login` saved, where it can find it). Building the app doesn't change the email: it lives in Supabase. Without a token, the script writes `confirm-signup-email.html` and tells you where to paste it (**Authentication → Emails → Confirm signup**, source view).

Keep **Authentication → URL Configuration → Site URL** set to your site's address: the button links to `<Site URL>/auth/confirm`. After signing up, people see a "Check your email" page with **Resend confirmation email** (once a minute) and **Back to login**; trying to log in before confirming offers the resend button too.

**Free Supabase projects** can only change the email design after connecting their own email provider (below); until then `npm run email:template` says so.

**Sending to real customers:** Supabase's built-in email service is only for testing. It sends a few emails an hour, and only to your project team's addresses. Before launch, connect your own email provider in **Authentication → Emails → SMTP Settings** (for example Resend, Postmark or Amazon SES), with a sender like `Rescue Bites <hello@your-domain>`. The template stays the same.

## Legal documents

Customer Terms, Restaurant Partner Agreement and Privacy Policy live in `src/lib/legal/documents.ts` (version `2026-09-29.1`, updated for Stripe Connect payouts and Supabase) and are shown at `/legal/...`. When you change the text, bump `LEGAL_VERSION` and add a migration updating `legal_documents`; a test checks they match. Signed-in users are then asked to accept the new version (declining signs them out). Have a Washington-licensed attorney review them before launch.

## Upgrading from the first version

The original Express + SQLite app is in `legacy/` for reference. Its demo data isn't migrated: run `npm run seed` for fresh demo data. Everyone accepts the updated terms (new version) on first sign-in.
