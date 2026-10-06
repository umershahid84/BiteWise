// Fee changes (grandfathered or not), renewal reminders and the delinquency email, against the local database.
// Emails are captured instead of sent.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Email } from '@/lib/email/send';
import type { FeeChangeInput } from '@/lib/fee-changes';

const sent: Email[] = [];
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (e: Email) => { sent.push(e); return true; }) }));

const fees = await import('@/lib/fee-changes');
const subs = await import('@/lib/subscriptions');
const { admin, signUp, supabaseAvailable } = await import('../support/db');

const available = await supabaseAvailable();
const card = (last4: string) => ({ brand: 'visa', last4, expMonth: 12, expYear: 2030 });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

async function paying(plan: 'monthly' | 'annual') {
  const owner = await signUp('restaurant');
  const db = admin();
  const r = (await db.from('restaurants').select('*').eq('owner_id', owner.id).single()).data!;
  await db.from('restaurants').update({ status: 'approved' }).eq('id', r.id);
  await subs.subscribe(r.id, { plan, token: card('4242'), autoRenew: true });
  return { owner, restaurant: r };
}
const subOf = async (rid: number) => (await admin().from('restaurant_subscriptions').select('*').eq('restaurant_id', rid).single()).data!;
const endNow = (rid: number) => admin().from('restaurant_subscriptions').update({ current_period_end: new Date(Date.now() - 60_000).toISOString() }).eq('restaurant_id', rid);
const lastPaid = async (rid: number) => (await admin().from('subscription_payments').select('amount_cents').eq('restaurant_id', rid).eq('status', 'paid').order('id', { ascending: false }).limit(1).single()).data!.amount_cents;

async function resetPrices() {
  const db = admin();
  await db.from('subscription_price_changes').update({ cancelled_at: new Date().toISOString() }).is('applied_at', null).is('cancelled_at', null);
  await db.from('settings').update({ value: 1500 }).eq('key', 'subscription_monthly_cents');
  await db.from('settings').update({ value: 15000 }).eq('key', 'subscription_annual_cents');
}

const change = (o: Partial<FeeChangeInput> = {}): FeeChangeInput => ({
  monthlyCents: 2000, annualCents: 20000, effectiveDate: today(), appliesToExisting: false, templateName: 'Test',
  subject: 'Fees change on {{effective_date}}', body: 'Hi {{restaurant}},\n\nNew fees: {{new_monthly}} a month.\n\n{{your_plan}}', includeFounding: false, ...o,
});

describe('effective times', () => {
  it('is 12:01 AM Pacific Time, standard or daylight', () => {
    expect(fees.effectiveInstant('2026-11-06').toISOString()).toBe('2026-11-06T08:01:00.000Z');
    expect(fees.effectiveInstant('2026-07-01').toISOString()).toBe('2026-07-01T07:01:00.000Z');
    expect(fees.effectiveLabel('2026-11-06T08:01:00Z')).toBe('Friday, November 6, 2026 at 12:01 AM PST');
  });
});

describe.skipIf(!available)('fee changes', () => {
  beforeEach(async () => {
    sent.length = 0;
    await resetPrices();
  });
  afterAll(async () => {
    await resetPrices();
    await admin().from('subscription_price_changes').delete().eq('template_name', 'Test'); // keep the history free of test runs
  });

  it('keeps existing restaurants at their fees when asked, and charges new ones the new fees', async () => {
    const existing = await paying('monthly');
    sent.length = 0;
    const res = await fees.scheduleChange(change({ appliesToExisting: false }), (await admin().from('profiles').select('id').eq('role', 'admin').limit(1).single()).data!.id);
    expect(res.sent).toBeGreaterThan(0);
    const mine = sent.find((e) => e.to === existing.owner.email)!;
    expect(mine.subject).toMatch(/^Fees change on \w+day, \w+ \d+, \d{4}$/);
    expect(mine.text).toMatch(/keeps its current price of \$15\.00 per month/);
    expect(mine.html).toContain('$20.00');
    await expect(fees.scheduleChange(change(), existing.owner.id)).rejects.toThrow(/already scheduled/);

    expect(await fees.applyDuePriceChanges()).toBe(1);
    expect((await subOf(existing.restaurant.id)).locked_monthly_cents).toBe(1500);
    await endNow(existing.restaurant.id);
    await subs.renewDue();
    expect(await lastPaid(existing.restaurant.id)).toBe(1500); // grandfathered

    const newcomer = await paying('monthly');
    expect(await lastPaid(newcomer.restaurant.id)).toBe(2000);
  });

  it('charges existing restaurants the new fees from their next renewal when asked', async () => {
    const existing = await paying('annual');
    await admin().from('restaurant_subscriptions').update({ locked_annual_cents: 15000 }).eq('restaurant_id', existing.restaurant.id); // an earlier lock
    sent.length = 0;
    await fees.scheduleChange(change({ appliesToExisting: true }), existing.owner.id);
    expect(sent.find((e) => e.to === existing.owner.email)!.text).toMatch(/new price of \$200\.00 per year from your first renewal/);
    await fees.applyDuePriceChanges();
    expect((await subOf(existing.restaurant.id)).locked_annual_cents).toBeNull();
    await endNow(existing.restaurant.id);
    await subs.renewDue();
    expect(await lastPaid(existing.restaurant.id)).toBe(20000);
  });

  it('sends a renewal reminder with the card, the amount and the date, once', async () => {
    const r = await paying('annual');
    const renewsOn = new Date(Date.now() + 20 * 86_400_000);
    await admin().from('restaurant_subscriptions').update({
      current_period_end: renewsOn.toISOString(), current_period_start: new Date(Date.now() - 300 * 86_400_000).toISOString(),
    }).eq('restaurant_id', r.restaurant.id);
    sent.length = 0;
    await subs.renewDue();
    const reminder = sent.find((e) => e.to === r.owner.email)!;
    expect(reminder.subject).toMatch(/renews on .*: \$150\.00 will be charged/);
    expect(reminder.text).toContain('VISA •••• 4242');
    expect(reminder.text).toContain(renewsOn.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }));
    sent.length = 0;
    await subs.renewDue();
    expect(sent.filter((e) => e.to === r.owner.email)).toEqual([]);
  });

  it('emails a delinquent restaurant that it can\'t post until it pays, with the renewal link', async () => {
    const r = await paying('monthly');
    await admin().from('payment_methods').update({ provider_ref: 'pm_mock_test_0002' }).eq('user_id', r.owner.id);
    await endNow(r.restaurant.id);
    sent.length = 0;
    await subs.renewDue();
    const mail = sent.find((e) => e.to === r.owner.email)!;
    expect(mail.subject).toMatch(/delinquent/);
    expect(mail.text).toMatch(/won't be able to post new offers until the payment is made/);
    expect(mail.text).toMatch(/\/restaurant\?tab=plan/);
  });
});
