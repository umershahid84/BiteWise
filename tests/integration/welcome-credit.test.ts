// The welcome bonus: platform credit a new customer gets once, when their email is confirmed.
import { describe, expect, it } from 'vitest';
import { grantWelcomeCredit } from '@/lib/customer-welcome';
import { admin, signUp, supabaseAvailable } from '../support/db';

const available = await supabaseAvailable();
const db = () => admin();
const balance = async (id: string) => ((await db().from('credit_ledger').select('amount_cents').eq('user_id', id)).data ?? []).reduce((n, r) => n + r.amount_cents, 0);
const confirm = (id: string) => db().auth.admin.updateUserById(id, { email_confirm: true });

describe.skipIf(!available)('welcome bonus', () => {
  it('gives a new customer $10.00 of credit once, after they confirm their email', async () => {
    const c = await signUp('customer');
    await db().auth.admin.updateUserById(c.id, { email_confirm: false }).catch(() => null);
    await confirm(c.id);
    expect(await grantWelcomeCredit(c.id)).toBe(1000);
    expect(await grantWelcomeCredit(c.id)).toBe(0); // only once
    expect(await balance(c.id)).toBe(1000);
    const entry = (await db().from('credit_ledger').select('kind, note').eq('user_id', c.id).single()).data;
    expect(entry).toEqual({ kind: 'goodwill', note: 'Welcome bonus' });
  });

  it("doesn't give it to restaurants, or when the admin set it to $0", async () => {
    const r = await signUp('restaurant');
    await confirm(r.id);
    expect(await grantWelcomeCredit(r.id)).toBe(0);
    const before = (await db().from('settings').select('value').eq('key', 'welcome_credit_cents').single()).data!.value;
    try {
      await db().from('settings').update({ value: 0 }).eq('key', 'welcome_credit_cents');
      const c = await signUp('customer');
      await confirm(c.id);
      expect(await grantWelcomeCredit(c.id)).toBe(0);
      expect(await balance(c.id)).toBe(0);
    } finally {
      await db().from('settings').update({ value: before }).eq('key', 'welcome_credit_cents');
    }
  });
});
