// The customer's order emails: "order placed" (hold receipt, PIN, Drive to Restaurant) once the card hold succeeds, sent
// only once, and the payment receipt (no directions) at pickup. Emails are captured.
import { describe, expect, it, vi } from 'vitest';
import type { Email } from '@/lib/email/send';

const sent: Email[] = [];
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (e: Email) => { sent.push(e); return true; }), emailConfigured: () => true }));

const orders = await import('@/lib/orders');
const { admin, restaurantWithOffer, signUp, supabaseAvailable, visa } = await import('../support/db');

const available = await supabaseAvailable();
const db = () => admin();
const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 100));
};

describe.skipIf(!available)('order emails', () => {
  it('sends the hold receipt with directions once when the order is placed, and the payment receipt without them at pickup', async () => {
    const shop = await restaurantWithOffer();
    const c = await signUp('customer');
    sent.length = 0;
    const res = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    await until(() => sent.length > 0);
    const pin = (await db().from('order_pins').select('pin').eq('order_id', res.orderId).single()).data!.pin;

    expect(sent).toHaveLength(1);
    const placed = sent[0];
    expect(placed.to).toBe(c.email);
    expect(placed.subject).toMatch(new RegExp(`^Order placed: .*\\(PIN ${pin}\\)$`));
    expect(placed.html).toContain('Drive to Restaurant');
    expect(placed.html).toContain(`/directions/${shop.restaurant.id}`);
    expect(placed.attachments?.[0].filename).toMatch(/^Bite-Wise-hold-receipt-BW-/);

    // Asking again (e.g. Stripe's webhook arriving later) doesn't send a second one.
    expect(await orders.emailOrderPlaced(res.orderId)).toBe(false);
    expect(sent).toHaveLength(1);

    const claimed = await shop.owner.client.rpc('restaurant_begin_pickup', { p_pin: pin, p_order_id: res.orderId });
    expect(claimed.error).toBeNull();
    const done = await orders.completePickup(claimed.data as { id: number; paymentRef: string | null; destinationAccount: string | null });
    orders.emailInvoiceAfterResponse(done.id); // as the dashboard and the kiosk do after handing over the food
    await until(() => sent.length > 1);
    expect(sent).toHaveLength(2);
    expect(sent[1].subject).toMatch(/^Payment confirmed: your Bite Wise receipt BW-/);
    expect(sent[1].html).not.toContain('Drive to Restaurant');
    expect(sent[1].html).not.toContain('/directions/');
  });
});
