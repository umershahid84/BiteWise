import { afterEach, describe, expect, it, vi } from 'vitest';

describe('sending email', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('explains an empty SMTP password instead of failing the login', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp.gmail.com');
    vi.stubEnv('SMTP_USER', 'someone@gmail.com');
    vi.stubEnv('SMTP_PASSWORD', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sendEmail } = await import('@/lib/email/send');
    expect(await sendEmail({ to: 'a@b.co', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' })).toBe(false);
    expect(warn.mock.calls[0][0]).toMatch(/SMTP_PASSWORD is empty/);
  });

  it('accepts a Gmail app password with spaces, or SMTP_PASS', async () => {
    vi.stubEnv('SMTP_PASSWORD', 'abcd efgh ijkl mnop');
    expect((await import('@/lib/env')).serverEnv.smtp.password).toBe('abcdefghijklmnop');
    vi.resetModules();
    vi.stubEnv('SMTP_PASSWORD', '');
    vi.stubEnv('SMTP_PASS', 'secret');
    expect((await import('@/lib/env')).serverEnv.smtp.password).toBe('secret');
  });
});
