// Sign-in cookies only last for the browser session: Supabase would keep them for 400 days, so we drop their
// lifetime (deletions, maxAge 0, are kept). Together with src/components/app/tab-session.tsx this logs people out
// when they close Bite Wise.
type Options = { maxAge?: number; expires?: Date; [k: string]: unknown };
export function sessionOnly<T extends Options | undefined>(options: T): T {
  if (!options || options.maxAge === 0) return options;
  const rest: Options = { ...options };
  delete rest.maxAge;
  delete rest.expires;
  return rest as T;
}
