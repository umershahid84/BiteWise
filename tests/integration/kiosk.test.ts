// Restaurant kiosks (no login: the secret link is the credential) and the signed agreement, against the local database.
import { describe, expect, it } from 'vitest';
import { kioskConfirm, kioskLookup, kioskOrders } from '@/app/actions/kiosk';
import { ensureKioskToken, kioskByToken, rotateKioskToken } from '@/lib/kiosk';
import { signedAgreementPdf } from '@/lib/legal/agreement-pdf';
import * as orders from '@/lib/orders';
import { admin, restaurantWithOffer, signUp, supabaseAvailable, visa } from '../support/db';

const available = await supabaseAvailable();
const pinOf = async (orderId: number) => (await admin().from('order_pins').select('pin').eq('order_id', orderId).single()).data!.pin;

describe.skipIf(!available)('kiosk', () => {
  it('gives each restaurant one secret link, and a new link turns the old one off', async () => {
    const shop = await restaurantWithOffer();
    const token = await ensureKioskToken(shop.restaurant.id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await ensureKioskToken(shop.restaurant.id)).toBe(token);
    expect(await kioskByToken(token)).toMatchObject({ restaurantId: shop.restaurant.id, status: 'approved' });
    const next = await rotateKioskToken(shop.restaurant.id);
    expect(next).not.toBe(token);
    expect(await kioskByToken(token)).toBeNull();
    expect(await kioskByToken('not a token')).toBeNull();
  });

  it('lets owners read only their own kiosk link', async () => {
    const mine = await restaurantWithOffer();
    const other = await restaurantWithOffer();
    await ensureKioskToken(mine.restaurant.id);
    await ensureKioskToken(other.restaurant.id);
    const rows = (await mine.owner.client.from('restaurant_kiosks').select('restaurant_id')).data!;
    expect(rows.map((r) => r.restaurant_id)).toEqual([mine.restaurant.id]);
    const customer = await signUp('customer');
    expect((await customer.client.from('restaurant_kiosks').select('token')).data).toEqual([]);
  });

  it('lists orders awaiting pickup and hands them over with the PIN', async () => {
    const shop = await restaurantWithOffer();
    const token = await ensureKioskToken(shop.restaurant.id);
    const c = await signUp('customer');
    const { orderId } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });

    const list = await kioskOrders(token);
    expect(list.ok && list.data.orders.map((o) => o.id)).toEqual([orderId]);

    const wrong = await kioskLookup(token, '0000');
    expect(wrong.ok).toBe(false);
    const pin = await pinOf(orderId);
    const found = await kioskLookup(token, pin);
    expect(found.ok && found.data.id).toBe(orderId);

    const done = await kioskConfirm(token, pin, orderId);
    expect(done.ok).toBe(true);
    expect((await orders.getOrder(orderId)).status).toBe('picked_up');
    const after = await kioskOrders(token);
    expect(after.ok && after.data).toMatchObject({ orders: [], pickedUpToday: 1 });
  });

  it("refuses unknown links and another restaurant's orders", async () => {
    const shop = await restaurantWithOffer();
    const other = await restaurantWithOffer();
    const c = await signUp('customer');
    const { orderId } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    const pin = await pinOf(orderId);
    expect((await kioskOrders('x'.repeat(32))).ok).toBe(false);
    const otherToken = await ensureKioskToken(other.restaurant.id);
    expect((await kioskLookup(otherToken, pin)).ok).toBe(false);
    expect((await kioskConfirm(otherToken, pin, orderId)).ok).toBe(false);
    expect((await orders.getOrder(orderId)).status).toBe('reserved');
  });
});

describe.skipIf(!available)('signed agreement', () => {
  it('is a PDF named after the restaurant', async () => {
    const shop = await restaurantWithOffer();
    const { filename, pdf } = await signedAgreementPdf(shop.restaurant.id, new Date().toISOString());
    expect(filename).toMatch(/^Bite-Wise-Partner-Agreement-Test-Kitchen-t-[a-f0-9]+\.pdf$/);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(20_000);
  });
});
