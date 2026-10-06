// The welcome email when an admin approves a restaurant, and why it sometimes waits. Emails are captured.
import { describe, expect, it, vi } from 'vitest';
import type { Email } from '@/lib/email/send';

const sent: Email[] = [];
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (e: Email) => { sent.push(e); return true; }), emailConfigured: () => true }));

const { onboardingMessage, sendOnboardingEmails } = await import('@/lib/restaurant-onboarding');
const { setRestaurantStatus } = await import('@/lib/moderation');
const { accepted, admin, signUp, supabaseAvailable, uid } = await import('../support/db');

const available = await supabaseAvailable();

describe.skipIf(!available)('restaurant welcome email', () => {
  it('waits for a confirmed email, sends once, and can be sent again on request', async () => {
    // An owner who hasn't clicked the confirmation link yet.
    const username = `t_${uid()}`;
    const email = `${username}@example.com`;
    const { data: link } = await admin().auth.admin.generateLink({
      type: 'signup', email, password: 'testpass123',
      options: { data: { username, role: 'restaurant', accepted_terms: accepted('restaurant'), restaurant: { name: `Test Kitchen ${username}`, address: '1 Test St', city: 'Seattle', zip: '98101' } } },
    });
    const ownerId = link.user!.id;
    const r = (await admin().from('restaurants').select('id').eq('owner_id', ownerId).single()).data!;
    await setRestaurantStatus(r.id, { status: 'approved' });

    sent.length = 0;
    const waiting = await sendOnboardingEmails(r.id);
    expect(waiting).toMatchObject({ sent: null, reason: 'not_confirmed', to: email });
    expect(onboardingMessage(waiting).text).toMatch(/hasn't confirmed their email/);
    expect(sent).toHaveLength(0);

    // They confirm: the welcome email goes out (what /auth/confirm does), with the signed agreement attached.
    await admin().auth.admin.updateUserById(ownerId, { email_confirm: true });
    expect(await sendOnboardingEmails(r.id)).toEqual({ sent: 'welcome', to: email });
    expect(sent.at(-1)?.attachments?.[0]?.contentType).toBe('application/pdf');
    expect(await sendOnboardingEmails(r.id)).toMatchObject({ sent: null, reason: 'already_sent' });
    expect(await sendOnboardingEmails(r.id, { resend: true })).toEqual({ sent: 'welcome', to: email });
    expect(sent.filter((e) => e.to === email)).toHaveLength(2);
  });

  it('a confirmed owner gets the welcome email as soon as the restaurant is approved', async () => {
    const owner = await signUp('restaurant');
    const r = (await admin().from('restaurants').select('id').eq('owner_id', owner.id).single()).data!;
    expect(await sendOnboardingEmails(r.id)).toEqual({ sent: 'pending', to: owner.email });
    await setRestaurantStatus(r.id, { status: 'approved' });
    const res = await sendOnboardingEmails(r.id);
    expect(res).toEqual({ sent: 'welcome', to: owner.email });
    expect(onboardingMessage(res)).toEqual({ ok: true, text: `Welcome email sent to ${owner.email}.` });
  });
});
