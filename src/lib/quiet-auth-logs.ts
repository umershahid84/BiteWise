// A browser that still holds a sign-in cookie for a session that no longer exists (after the database was reset,
// the account was deleted or signed out everywhere, or a very old login) makes the Supabase library print
// "AuthApiError: Invalid Refresh Token: Refresh Token Not Found" on every request. The library already handles it:
// the cookie is cleared and the visitor is simply logged out. This keeps those expected messages out of the server
// log; every other warning and error is printed as before.
const EXPECTED = new Set(['refresh_token_not_found', 'refresh_token_already_used', 'session_expired', 'session_not_found']);

export const isStaleSessionError = (x: unknown) =>
  typeof x === 'object' && x !== null && (x as { __isAuthError?: boolean }).__isAuthError === true &&
  EXPECTED.has(String((x as { code?: unknown }).code));

export function quietStaleSessionLogs() {
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      if (args.length === 1 && isStaleSessionError(args[0])) return;
      original(...args);
    };
  }
}
