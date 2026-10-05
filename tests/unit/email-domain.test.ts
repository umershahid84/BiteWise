import { describe, expect, it } from 'vitest';
import { checkEmailDomain, isDisposable } from '@/lib/email-domain';
import { addPeriod } from '@/lib/subscriptions';

const err = (code: string) => Object.assign(new Error(code), { code });

// A fake DNS: domain -> MX hosts (or an error code), and which domains have an address record.
function dns(mx: Record<string, string[] | string>, a: string[] = []) {
  return {
    mx: (async (d: string) => {
      const v = mx[d];
      if (v === undefined) throw err('ENOTFOUND');
      if (typeof v === 'string') throw err(v);
      return v.map((exchange, i) => ({ exchange, priority: i }));
    }) as never,
    a: (async (d: string) => {
      if (a.includes(d)) return ['93.184.215.14'];
      throw err('ENOTFOUND');
    }) as never,
    aaaa: (async () => {
      throw err('ENODATA');
    }) as never,
  };
}

describe('sign-up email domains', () => {
  it('accepts domains that receive mail', async () => {
    const d = dns({ 'gmail.com': ['gmail-smtp-in.l.google.com'], 'uw.edu': ['mx.uw.edu'] }, ['oldschool.org']);
    expect(await checkEmailDomain('sam@gmail.com', d)).toEqual({ ok: true });
    expect(await checkEmailDomain('Sam@UW.EDU', d)).toEqual({ ok: true });
    expect(await checkEmailDomain('sam@oldschool.org', d)).toEqual({ ok: true }); // no MX, but an address record
  });

  it('refuses disposable inboxes, including their subdomains', async () => {
    const d = dns({ 'mailinator.com': ['mail.mailinator.com'], 'x.yopmail.com': ['mx.yopmail.com'] });
    expect(isDisposable('sub.mailinator.com')).toBe(true);
    expect(isDisposable('gmail.com')).toBe(false);
    for (const email of ['a@mailinator.com', 'a@x.yopmail.com', 'a@guerrillamail.com', 'a@10minutemail.com']) {
      const res = await checkEmailDomain(email, d);
      expect(res.ok).toBe(false);
      expect(!res.ok && res.reason).toMatch(/disposable/);
    }
  });

  it('refuses made-up, reserved and mail-less domains', async () => {
    const d = dns({ 'nomail.com': ['.'] });
    for (const email of ['a@gmial.cmo', 'a@example.com', 'a@bitewise.test', 'a@shop.local', 'a@nomail.com', 'a@localhost', 'a@1.2.3.4']) {
      expect((await checkEmailDomain(email, d)).ok, email).toBe(false);
    }
  });

  it('does not block anyone when DNS itself fails', async () => {
    expect(await checkEmailDomain('a@company.com', dns({ 'company.com': 'ETIMEOUT' }))).toEqual({ ok: true });
  });
});

describe('plan periods', () => {
  it('adds a month or a year, keeping month ends', () => {
    expect(addPeriod(new Date('2026-10-06T10:00:00Z'), 'monthly').toISOString()).toBe('2026-11-06T10:00:00.000Z');
    expect(addPeriod(new Date('2027-01-31T10:00:00Z'), 'monthly').toISOString()).toBe('2027-02-28T10:00:00.000Z');
    expect(addPeriod(new Date('2028-02-29T10:00:00Z'), 'annual').toISOString()).toBe('2029-02-28T10:00:00.000Z');
    expect(addPeriod(new Date('2026-12-15T10:00:00Z'), 'annual').toISOString()).toBe('2027-12-15T10:00:00.000Z');
  });
});
