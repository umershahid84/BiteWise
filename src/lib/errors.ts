// Errors with an HTTP-style status and a message that is safe to show to the user.

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const bad = (message: string) => new AppError(400, message);
export const notFound = (message: string) => new AppError(404, message);
export const conflict = (message: string) => new AppError(409, message);
export const forbidden = (message: string) => new AppError(403, message);

// Database functions raise errors with custom SQLSTATE codes (see supabase/migrations/*functions.sql).
const DB_CODES: Record<string, number> = {
  BB400: 400, BB402: 402, BB403: 403, BB404: 404, BB409: 409, BB429: 429,
  '22023': 400, '23505': 409, '28000': 401,
};

// Converts a PostgREST/Supabase error into an AppError. Unknown database errors become a generic
// 500 so internal details never reach the browser.
export function fromDb(err: { code?: string; message: string } | null | undefined): AppError | null {
  if (!err) return null;
  const status = err.code ? DB_CODES[err.code] : undefined;
  if (status) return new AppError(status, err.message, err.code);
  console.error('Database error:', err);
  return new AppError(500, 'Something went wrong. Please try again.');
}

type DbResult<T> = { data: T; error: { code?: string; message: string } | null };

// Throws if a Supabase call failed or returned no data; otherwise returns the data.
export function must<T>(res: DbResult<T>): NonNullable<T> {
  const err = fromDb(res.error);
  if (err) throw err;
  if (res.data === null || res.data === undefined) throw new AppError(404, 'Not found.');
  return res.data as NonNullable<T>;
}

// Throws if a Supabase call failed; the data may be null (e.g. maybeSingle()).
export function maybe<T>(res: DbResult<T>): T {
  const err = fromDb(res.error);
  if (err) throw err;
  return res.data;
}

// Throws if a Supabase call failed (for calls that return nothing).
export function check(res: { error: { code?: string; message: string } | null }): void {
  const err = fromDb(res.error);
  if (err) throw err;
}

// Server Actions return errors as values: thrown errors are hidden in production builds.
export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string; status: number; code?: string };

export async function action<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message, status: err.status, ...(err.code ? { code: err.code } : {}) };
    // redirect() and notFound() work by throwing; let Next.js handle them.
    if (err && typeof err === 'object' && 'digest' in err && String((err as { digest: unknown }).digest).startsWith('NEXT_')) throw err;
    console.error(err);
    return { ok: false, error: 'Something went wrong. Please try again.', status: 500 };
  }
}
