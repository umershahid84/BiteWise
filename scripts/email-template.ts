// Prepares the branded sign-up email (supabase/templates/confirmation.html) for a Supabase project on
// supabase.com. Usage: npm run email:template
//
// Email apps load the logo from a public web address. The template points at the site's own
// /assets/email-logo.png, which only works once the site is online, so this uploads the logo to a public
// "brand" storage bucket in the project and writes confirm-signup-email.html with that address, ready to
// paste into the dashboard (Authentication → Emails → Confirm signup). The local Supabase stack
// (npm run db:start) uses the template directly, through supabase/config.toml.
import fs from 'node:fs';
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
  fs.writeFileSync(OUT, html);

  console.log(`Logo uploaded: ${logoUrl}
Wrote ${OUT}. To use it:
  1. Supabase dashboard → Authentication → Emails → "Confirm signup".
  2. Subject:  ${SUBJECT}
  3. Body: switch to the source (<>) view, delete what is there, and paste the whole of ${OUT}. Save.
The button links to your Site URL (Authentication → URL Configuration), so keep that set to your site's address.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
