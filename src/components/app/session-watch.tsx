'use client';

import { useEffect } from 'react';
import { loginForPath } from '@/lib/constants';

// Sends this page to the log-in page as soon as it notices the session has ended (logged out in another tab, after
// the idle timeout, or the session expired) or another account has logged in, instead of leaving a page whose buttons no longer work. It checks when
// the tab comes back into view and once a minute.
export function sendToLogin() {
  const here = location.pathname + location.search;
  // A full page load, so nothing from the ended session stays in memory.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  location.assign(`${loginForPath(location.pathname)}?session=1&next=${encodeURIComponent(here)}`);
}

export function SessionWatch({ userId }: { userId: string }) {
  useEffect(() => {
    let gone = false;
    const check = async () => {
      if (gone || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/session', { cache: 'no-store' });
        if (!res.ok) return;
        const s = (await res.json()) as { signedIn: boolean; userId: string | null };
        if (!s.signedIn) {
          gone = true;
          sendToLogin();
        } else if (s.userId !== userId) {
          // Another account logged in on this browser (in another tab): reload, so this tab shows that account's pages.
          gone = true;
          location.reload();
        }
      } catch {
        // offline: try again later
      }
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    const timer = setInterval(check, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      clearInterval(timer);
    };
  }, [userId]);
  return null;
}
