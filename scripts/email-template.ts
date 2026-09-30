// Installs the branded sign-up email (supabase/templates/confirmation.html) in a Supabase project on
// supabase.com. Usage: npm run email:template
//
// Email apps load the logo from a public web address. The template points at the site's own
// /assets/email-logo.png, which only works once the site is online, so this uploads the logo to a public
// "brand" storage bucket in the project and uses that address instead. Then it sets the "Confirm signup"
// subject and body through the Supabase Management API, with a personal access token: SUPABASE_ACCESS_TOKEN
// in .env.local, or the one `npx supabase login` saved. Without a token it writes confirm-signup-email.html
// to paste into the dashboard by hand. The local Supabase stack (npm run db:start) uses the template
// directly, through supabase/config.toml.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example).');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const BUCKET = 'brand';
const LOGO = 'email-logo.png';
const OUT = 'confirm-signup-email.html';
const SUBJECT = 'Confirm your email for Rescue Bites 🥡';

async function main() {
  const bucket = await db.storage.getBucket(BUCKET);
  if (bucket.error) {
    const created = await db.storage.createBucket(BUCKET, { public: true });
    if (created.error) throw new Error(`create the ${BUCKET} bucket: ${created.error.message}`);
  }
  const upload = await db.storage.from(BUCKET).upload(LOGO, fs.readFileSync(`public/assets/${LOGO}`), {
    contentType: 'image/png', cacheControl: '86400', upsert: true,
  });
  if (upload.error) throw new Error(`upload the logo: ${upload.error.message}`);
  const logoUrl = db.storage.from(BUCKET).getPublicUrl(LOGO).data.publicUrl;

  const html = fs.readFileSync('supabase/templates/confirmation.html', 'utf8').replaceAll('{{ .SiteURL }}/assets/email-logo.png', logoUrl);
  console.log(`Logo uploaded: ${logoUrl}`);

  const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url!)?.[1];
  const token = accessToken();
  if (ref && token) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailer_subjects_confirmation: SUBJECT, mailer_templates_confirmation_content: html }),
    });
    if (res.ok) {
      console.log(`Installed the "Confirm signup" email in project ${ref}. New sign-ups get the Rescue Bites email from now on.
The button links to your Site URL (Authentication → URL Configuration), so keep that set to your site's address.`);
      return;
    }
    const body = await res.text();
    if (/custom SMTP/i.test(body)) {
      console.log(`Supabase doesn't allow a custom email design on free projects that use its built-in email sender (which also
only sends a few emails an hour, to your team only). Connect your own email provider first: Supabase dashboard →
Authentication → Emails → SMTP Settings (see "Branded emails" in README.md). Then run npm run email:template again.`);
      return;
    }
    console.log(`Couldn't install it automatically (${res.status}: ${body.slice(0, 200)}).`);
    if (res.status === 401) console.log('The access token is invalid or expired: run npx supabase login again, or set a new SUPABASE_ACCESS_TOKEN.');
  } else if (!ref) {
    console.log('NEXT_PUBLIC_SUPABASE_URL is not a supabase.com project, so there is nothing to install: the local stack uses supabase/config.toml.');
  } else {
    console.log(`No Supabase access token found, so the email can't be installed automatically. Either run npx supabase login, or create
a token at https://supabase.com/dashboard/account/tokens and add SUPABASE_ACCESS_TOKEN=... to .env.local, then run this again.`);
  }

  fs.writeFileSync(OUT, html);
  console.log(`Or paste it by hand: wrote ${OUT}.
  1. Supabase dashboard → Authentication → Emails → "Confirm signup".
  2. Subject:  ${SUBJECT}
  3. Body: switch to the source (<>) view, delete what is there, and paste the whole of ${OUT}. Save.`);
}

// A personal access token: SUPABASE_ACCESS_TOKEN, or the file `npx supabase login` writes when it can't use the
// system keychain.
function accessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const file = path.join(os.homedir(), '.supabase', 'access-token');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
