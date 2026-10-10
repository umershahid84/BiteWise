// Forgot password, customer welcome email, admin edits, restaurant staff and menu import, against the local
// database. Emails are captured.
import { describe, expect, it, vi } from 'vitest';
import type { Email } from '@/lib/email/send';

const sent: Email[] = [];
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (e: Email) => { sent.push(e); return true; }), emailConfigured: () => true }));

const { requestPasswordReset, resetPassword } = await import('@/lib/password-reset');
const { sendCustomerWelcome } = await import('@/lib/customer-welcome');
const { updateAccount } = await import('@/lib/admin-edit');
const { createStaff, listStaff, removeStaff, updateStaff } = await import('@/lib/staff');
const { importMenu } = await import('@/lib/menu-import');
const { setRestaurantStatus } = await import('@/lib/moderation');
const { admin, anon, PASSWORD, restaurantWithOffer, signUp, supabaseAvailable, uid } = await import('../support/db');

const available = await supabaseAvailable();
const codeIn = (e: Email | undefined) => /(\d{6}) is your Bite Wise password reset code/.exec(e?.subject ?? '')?.[1];
const login = async (email: string, password: string) => {
  const client = anon();
  const { error } = await client.auth.signInWithPassword({ email, password });
  return error ? null : client;
};

describe.skipIf(!available)('accounts', () => {
  it('resets a forgotten password with the 6-digit code, and locks the code after 5 wrong tries', async () => {
    const user = await signUp('customer');
    sent.length = 0;
    await requestPasswordReset(user.email.toUpperCase());
    const code = codeIn(sent.at(-1));
    expect(code).toMatch(/^\d{6}$/);
    expect(sent.at(-1)?.to).toBe(user.email);
    await expect(requestPasswordReset(user.username)).rejects.toThrow(/less than a minute ago/);
    await requestPasswordReset('nobody-here@example.com'); // no account: same answer, no email
    expect(sent).toHaveLength(1);

    const wrong = code === '000000' ? '111111' : '000000';
    await expect(resetPassword(user.email, wrong, 'newpass123')).rejects.toThrow(/4 tries left/);
    expect(await resetPassword(user.email, code!, 'newpass123')).toBe('main');
    expect(await login(user.email, PASSWORD)).toBeNull();
    expect(await login(user.email, 'newpass123')).not.toBeNull();
    await expect(resetPassword(user.email, code!, 'another123')).rejects.toThrow(/wrong or has expired/); // used up

    // A new code; five wrong tries lock it, even the right code then fails.
    await admin().from('profiles').update({ password_reset_sent_at: null }).eq('id', user.id);
    await requestPasswordReset(user.email);
    const code2 = codeIn(sent.at(-1))!;
    const bad = code2 === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) await expect(resetPassword(user.email, bad, 'another123')).rejects.toThrow(/(tries|try) left/);
    await expect(resetPassword(user.email, bad, 'another123')).rejects.toThrow(/Too many wrong codes/);
    await expect(resetPassword(user.email, code2, 'another123')).rejects.toThrow(/Too many wrong codes/);
  });

  it('welcomes a confirmed customer once (an admin can send it again) and lets an admin change email and user name', async () => {
    const user = await signUp('customer');
    sent.length = 0;
    expect(await sendCustomerWelcome(user.id)).toEqual({ sent: true, to: user.email });
    expect(sent.at(-1)?.subject).toMatch(/Congratulations/);
    expect(sent.at(-1)?.html).toContain('/app?device=iphone');
    expect(await sendCustomerWelcome(user.id)).toMatchObject({ sent: false, reason: 'already_sent' });

    const email = `t_${uid()}@example.com`;
    const username = `t_${uid()}`;
    expect(await updateAccount(user.id, { email, username })).toHaveLength(2);
    expect((await admin().from('profiles').select('email, username').eq('id', user.id).single()).data).toEqual({ email, username });
    expect(await login(email, PASSWORD)).not.toBeNull();
    expect(await sendCustomerWelcome(user.id, { resend: true })).toEqual({ sent: true, to: email });
    const other = await signUp('customer');
    await expect(updateAccount(user.id, { username: other.username })).rejects.toThrow(/already taken/);
  });

  it('gives restaurant staff the menu, offers and orders, but not money, billing or payouts', async () => {
    const shop = await restaurantWithOffer();
    const rid = shop.restaurant.id;
    const username = `staff_${uid()}`;
    const staffId = await createStaff(rid, shop.owner.id, { fullName: 'Maria Lopez', username, password: 'staffpass1', title: 'Manager' });
    const [member] = await listStaff(rid);
    expect(member).toMatchObject({ userId: staffId, username, fullName: 'Maria Lopez', title: 'Manager', status: 'active' });
    const email = (await admin().from('profiles').select('email, role').eq('id', staffId).single()).data!;
    expect(email.role).toBe('staff');
    expect(email.email).toMatch(/@staff\.bitewise\.invalid$/);

    const staff = (await login(email.email, 'staffpass1'))!;
    expect(staff).not.toBeNull();
    expect((await staff.rpc('my_restaurant_id')).data).toBe(rid);
    expect((await staff.from('restaurants').select('id').eq('id', rid)).data).toHaveLength(1);
    // Menu: add an item and change a price.
    const item = await staff.from('menu_items').insert({ restaurant_id: rid, name: 'Staff Special', price_cents: 900 }).select('id').single();
    expect(item.error).toBeNull();
    expect((await staff.from('menu_items').update({ price_cents: 1100 }).eq('id', item.data!.id).select('price_cents').single()).data?.price_cents).toBe(1100);
    // Post surplus food.
    const offer = await staff.rpc('restaurant_save_offer', {
      p_offer_id: null as unknown as number, p_menu_item_id: item.data!.id, p_reason: 'end_of_day', p_description: '',
      p_discount_pct: 50, p_quantity: 2, p_expires_in_minutes: 60,
    });
    expect(offer.error).toBeNull();
    // Not for staff: payouts, payment account, plan, invoices, kiosk link; nor the restaurant's profile.
    for (const table of ['payouts', 'restaurant_payment_accounts', 'restaurant_subscriptions', 'subscription_payments', 'restaurant_kiosks'] as const) {
      expect((await staff.from(table).select('*').eq('restaurant_id', rid)).data, table).toEqual([]);
    }
    expect((await staff.from('restaurants').update({ name: 'Hacked' }).eq('id', rid).select('id')).data ?? []).toEqual([]);
    // The owner still sees them.
    expect((await shop.owner.client.from('restaurant_payment_accounts').select('restaurant_id').eq('restaurant_id', rid)).data).toHaveLength(1);

    // Paused by the owner: no log-in. On again: works.
    await updateStaff(rid, staffId, { fullName: 'Maria Lopez', title: 'Supervisor', active: false });
    expect(await login(email.email, 'staffpass1')).toBeNull();
    await updateStaff(rid, staffId, { fullName: 'Maria Lopez', title: 'Supervisor', active: true, password: 'newstaff22' });
    const again = (await login(email.email, 'newstaff22'))!;
    expect(again).not.toBeNull();
    // A banned restaurant's staff lose access.
    await setRestaurantStatus(rid, { status: 'banned', note: 'test' });
    expect((await again.rpc('my_restaurant_id')).data).toBeNull();
    // Another restaurant's owner can't touch them; this one can delete them.
    const other = await restaurantWithOffer();
    await expect(removeStaff(other.restaurant.id, staffId)).rejects.toThrow(/not found/);
    await removeStaff(rid, staffId);
    expect(await listStaff(rid)).toEqual([]);
  });

  it('imports menu items, skipping or updating dishes already on the menu', async () => {
    const shop = await restaurantWithOffer();
    const rid = shop.restaurant.id;
    const items = [
      { name: 'Test Bowl', description: 'New description', priceCents: 1300, imageUrl: null, dietary: [] },
      { name: 'Pad Thai', description: 'Noodles', priceCents: 1450, imageUrl: null, dietary: ['spicy' as const] },
    ];
    expect(await importMenu(rid, items, { updateExisting: false })).toEqual({ added: 1, updated: 0, skipped: 1, photos: 0, photosFailed: 0 });
    expect(await importMenu(rid, items, { updateExisting: true })).toEqual({ added: 0, updated: 2, skipped: 0, photos: 0, photosFailed: 0 });
    const menu = (await admin().from('menu_items').select('name, price_cents, description, dietary').eq('restaurant_id', rid).eq('active', true).order('name')).data;
    expect(menu).toEqual([
      { name: 'Pad Thai', price_cents: 1450, description: 'Noodles', dietary: ['spicy'] },
      { name: 'Test Bowl', price_cents: 1300, description: 'New description', dietary: [] },
    ]);
  });
});
