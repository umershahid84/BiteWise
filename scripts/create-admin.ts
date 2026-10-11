// Creates (or resets the password of) an owner/admin account. Admins can't sign up on the website.
//   npm run create-admin -- --email you@example.com --username owner
// The password is read from ADMIN_PASSWORD or asked for interactively (not echoed).
import { config } from 'dotenv';
import readline from 'node:readline';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/database.types';
import { LEGAL_VERSION, requiredIds } from '../src/lib/legal/documents';
import { emailSchema, passwordSchema, usernameSchema } from '../src/lib/validate';

config({ path: '.env.local' });
config();

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s) => {
      if (s.includes(question)) out.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const check = <T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: { message: string }[] } } }, v: unknown) => {
  const r = schema.safeParse(v);
  if (!r.success) throw new Error(r.error!.issues[0].message);
  return r.data as T;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example).');
  const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const email = check<string>(emailSchema, arg('email'));
  const username = check<string>(usernameSchema, arg('username') ?? 'owner');
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await askHidden('Admin password (min 8 chars, letters and numbers): ');
    if (password !== (await askHidden('Repeat password: '))) throw new Error('Passwords do not match.');
  }
  check<string>(passwordSchema, password);

  const { data: existing } = await db.from('profiles').select('id, role, email, username').or(`email.eq.${email},username.eq.${username}`).maybeSingle();
  if (existing && existing.role !== 'admin') {
    throw new Error(`${existing.email} is already a ${existing.role} account. Use a different email and user name.`);
  }
  if (existing) {
    const { error } = await db.auth.admin.updateUserById(existing.id, { password, ban_duration: 'none' });
    if (error) throw error;
    await db.from('profiles').update({ status: 'active' }).eq('id', existing.id);
    console.log(`Updated admin ${existing.username} <${existing.email}>.`);
    return;
  }

  // Sign-up only creates customers and restaurants, so the account is created as a customer and
  // then promoted to admin with the service-role key.
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username, role: 'customer', ip: 'cli', user_agent: 'npm run create-admin',
      accepted_terms: Object.fromEntries(requiredIds('customer').map((d) => [d, LEGAL_VERSION])),
    },
  });
  if (error) throw error;
  const { error: promoteError } = await db.from('profiles').update({ role: 'admin' }).eq('id', data.user.id);
  if (promoteError) throw promoteError;
  await db.auth.admin.updateUserById(data.user.id, { app_metadata: { role: 'admin' } });
  console.log(`Created admin ${username} <${email}>. Log in at /login, then open /admin.`);
}

main().catch((err) => {
  console.error(`Error: ${err.message ?? err}`);
  process.exitCode = 1;
});
