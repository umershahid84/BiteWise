import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { confirmationEmail, renderConfirmation } from '@/lib/email/confirmation';

const template = fs.readFileSync('supabase/templates/confirmation.html', 'utf8');

describe('sign-up confirmation email', () => {
  it('fills in every template tag for a restaurant', () => {
    const html = renderConfirmation(template, { email: 'chef@x.com', tokenHash: 'abc123', username: 'chef', role: 'restaurant', restaurant: 'Pho & Co' }, 'https://bitewise.app/');
    expect(html).not.toMatch(/\{\{/);
    expect(html).toContain('Welcome, chef!');
    expect(html).toContain('<b>Pho &amp; Co</b>');
    expect(html).toContain('Turn surplus food into revenue');
    expect(html).not.toContain('up to 70% off');
    expect(html).toContain('https://bitewise.app/auth/confirm?token_hash=abc123&type=email');
    expect(html).toContain('src="cid:logo"');
    expect(html).not.toMatch(/rescue bites/i);
  });

  it('shows the customer wording for customers', () => {
    const html = renderConfirmation(template, { email: 'a@x.com', tokenHash: 't', username: 'ann', role: 'customer' });
    expect(html).not.toMatch(/\{\{/);
    expect(html).toContain('up to 70% off');
    expect(html).not.toContain('Turn surplus food into revenue');
  });

  it('has a Bite Wise subject and a plain-text version with the link', () => {
    const e = confirmationEmail({ email: 'a@x.com', tokenHash: 'tok', username: 'ann', role: 'customer' });
    expect(e.subject).toMatch(/Bite Wise/);
    expect(e.text).toMatch(/\/auth\/confirm\?token_hash=tok&type=email/);
  });
});
