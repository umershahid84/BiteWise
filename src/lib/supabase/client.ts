'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';
import { publicEnv } from '@/lib/env';
import { sessionOnly } from './session-cookie';

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

// One Supabase client per browser tab. Queries run as the signed-in user, so RLS applies.
export function supabaseBrowser() {
  client ??= createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    // Same cookies as the default, but they end with the browser session (./session-cookie.ts).
    cookies: {
      getAll: () => document.cookie.split('; ').filter(Boolean).map((c) => {
        const i = c.indexOf('=');
        return { name: c.slice(0, i), value: decodeURIComponent(c.slice(i + 1)) };
      }),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          const o = sessionOnly(options);
          document.cookie = [
            `${name}=${encodeURIComponent(value)}`, `path=${o?.path ?? '/'}`, `samesite=${o?.sameSite ?? 'lax'}`,
            ...(o?.maxAge === 0 ? ['max-age=0'] : []), ...(o?.domain ? [`domain=${o.domain}`] : []), ...(location.protocol === 'https:' ? ['secure'] : []),
          ].join('; ');
        }
      },
    },
  });
  return client;
}
