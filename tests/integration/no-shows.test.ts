// Missed pickups: 3 in a row suspend the account for 30 days (lifted automatically), and the first one after that
// bans it for good. Against the local database; emails are captured instead of sent.
import { describe, expect, it, vi } from 'vitest';
import type { Email } from '@/lib/email/send';

const sent: Email[] = [];
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (e: Email) => { sent.push(e); return true; }), emailConfigured: () => true }));

const orders = await import('@/lib/orders');
const { processAlerts } = await import('@/lib/no-shows');
const { admin, restaurantWithOffer, signUp, supabaseAvailable, visa } = await import('../support/db');

const available = await supabaseAvailable();
const profile = async (id: string) => (await admin().from('profiles').select('*').eq('id', id).single()).data!;
const alertsFor = async (id: string) => (await admin().from('admin_alerts').select('*').eq('user_id', id).order('id')).data!;
const authUser = async (id: string) => (await admin().auth.admin.getUserById(id)).data.user!;

// Places an order and lets it run out without a pickup (what the sweep does after the discard timer).
async function missPickup(userId: string, offerId: number) {
  const { orderId } = await orders.checkout(userId, { offerId, quantity: 1, creditCents: 0, newCard: visa });
  await orders.release(orderId, 'reserved', 'expired', false);
  return orderId;
}

describe.skipIf(!available)('missed pickups', () => {
  it('suspends after 3 in a row, reactivates after 30 days, then bans on the next one', async () => {
    const shop = await restaurantWithOffer({ quantity: 10 });
    const c = await signUp('customer');

    await missPickup(c.id, shop.offer.id);
    await missPickup(c.id, shop.offer.id);
    expect(await profile(c.id)).toMatchObject({ status: 'active', no_show_strikes: 2, no_shows_total: 2, no_show_probation: false });

    // An open order the customer still has: cancelled by the suspension.
    const { orderId: open } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    await missPickup(c.id, shop.offer.id);
    const suspended = await profile(c.id);
    expect(suspended).toMatchObject({ status: 'suspended', no_show_strikes: 0, no_shows_total: 3, no_show_probation: true });
    const days = (Date.parse(suspended.suspended_until!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    expect((await alertsFor(c.id)).map((a) => a.kind)).toEqual(['no_show', 'no_show', 'no_show_suspension']);

    sent.length = 0;
    await processAlerts();
    expect((await orders.getOrder(open)).status).toBe('cancelled');
    expect((await authUser(c.id)).banned_until).toBeTruthy();
    expect(sent.some((e) => e.to === c.email && /suspended for 30 days/.test(e.subject))).toBe(true);
    expect(sent.some((e) => /Bite Wise alert: .* suspended for 30 days/.test(e.subject))).toBe(true);
    expect((await alertsFor(c.id)).every((a) => a.processed_at)).toBe(true);
    // Processing again does nothing (no second email).
    const before = sent.length;
    await processAlerts();
    expect(sent.length).toBe(before);

    // 30 days later the sweep reactivates the account by itself.
    await admin().from('profiles').update({ suspended_until: new Date(Date.now() - 1000).toISOString() }).eq('id', c.id);
    await admin().auth.admin.updateUserById(c.id, { ban_duration: 'none' }); // Supabase's own timed ban has run out too
    await orders.sweep();
    expect(await profile(c.id)).toMatchObject({ status: 'active', suspended_until: null, no_show_probation: true });

    // The first missed pickup after the suspension: banned for good.
    await missPickup(c.id, shop.offer.id);
    expect((await profile(c.id)).status).toBe('banned');
    expect((await alertsFor(c.id)).at(-1)!.kind).toBe('no_show_ban');
    sent.length = 0;
    await processAlerts();
    const ban = await authUser(c.id);
    expect(Date.parse(ban.banned_until!) - Date.now()).toBeGreaterThan(50 * 365 * 86_400_000);
    expect(sent.some((e) => e.to === c.email && /closed/.test(e.subject))).toBe(true);
    expect(sent.some((e) => /Bite Wise alert: .* banned/.test(e.subject))).toBe(true);
  });

  it('a pickup resets the count, and cancelled orders never count', async () => {
    const shop = await restaurantWithOffer({ quantity: 10 });
    const c = await signUp('customer');
    await missPickup(c.id, shop.offer.id);
    await missPickup(c.id, shop.offer.id);
    const { orderId } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    const order = await orders.getOrder(orderId);
    const claimed = (await admin().rpc('begin_pickup_for', { p_restaurant_id: shop.restaurant.id, p_pin: (await admin().from('order_pins').select('pin').eq('order_id', orderId).single()).data!.pin, p_order_id: orderId })).data as unknown as { id: number; paymentRef: string | null; destinationAccount: string | null };
    await orders.completePickup(claimed ?? { id: order.id, paymentRef: order.payment_ref, destinationAccount: null });
    expect(await profile(c.id)).toMatchObject({ no_show_strikes: 0, no_shows_total: 2, status: 'active' });

    const { orderId: cancelled } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    await orders.release(cancelled, 'reserved', 'cancelled', true);
    expect((await profile(c.id)).no_show_strikes).toBe(0);
  });
});
