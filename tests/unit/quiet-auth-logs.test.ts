import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStaleSessionError, quietStaleSessionLogs } from '@/lib/quiet-auth-logs';

const authError = (code: string) => Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { __isAuthError: true, status: 400, code });

describe('stale sign-in cookies', () => {
  const { warn, error } = console;
  afterEach(() => {
    console.warn = warn;
    console.error = error;
  });

  it('recognises only the expected dead-session auth errors', () => {
    expect(isStaleSessionError(authError('refresh_token_not_found'))).toBe(true);
    expect(isStaleSessionError(authError('refresh_token_already_used'))).toBe(true);
    expect(isStaleSessionError(authError('invalid_credentials'))).toBe(false);
    expect(isStaleSessionError(new Error('database down'))).toBe(false);
    expect(isStaleSessionError('refresh_token_not_found')).toBe(false);
  });

  it('drops those messages and prints everything else', () => {
    const printedWarn = vi.fn();
    const printedError = vi.fn();
    console.warn = printedWarn;
    console.error = printedError;
    quietStaleSessionLogs();
    console.warn(authError('refresh_token_not_found'));
    console.error(authError('refresh_token_not_found'));
    console.error(authError('invalid_credentials'));
    console.warn('Scheduled jobs are paused');
    console.error('scheduled jobs:', authError('refresh_token_not_found')); // with context: kept
    expect(printedWarn.mock.calls).toEqual([['Scheduled jobs are paused']]);
    expect(printedError).toHaveBeenCalledTimes(2);
  });
});
