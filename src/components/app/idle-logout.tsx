'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { logOut } from '@/app/actions/auth';

// Logs a signed-in user out after 10 minutes without activity (mouse, keyboard, touch or scrolling), in every tab at
// once: the time of the last activity is shared between tabs through localStorage. One minute before, a notice
// offers to stay logged in. Coming back to a tab (or the browser) after more than 10 minutes logs out at once.
// The restaurant kiosk has no account session, so it is never logged out.
const IDLE_MS = 10 * 60_000;
const WARN_MS = 60_000;
const KEY = 'bitewise.lastActive';
const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart', 'wheel'] as const;

let memory = 0; // when localStorage is unavailable
const read = () => {
  try {
    return Number(localStorage.getItem(KEY)) || memory;
  } catch {
    return memory;
  }
};
const write = (t: number) => {
  memory = t;
  try {
    localStorage.setItem(KEY, String(t));
  } catch {
    // storage unavailable
  }
};

// Called right after logging in, so an old timestamp from an earlier visit doesn't log the new session out.
export const markActive = () => write(Date.now());

export function IdleLogout() {
  const warned = useRef<string | number | null>(null);
  const done = useRef(false);

  useEffect(() => {
    const last = read();
    // Back after a long break (the tab or the browser was closed): log out now.
    const expired = last > 0 && Date.now() - last >= IDLE_MS;
    if (!expired) write(Date.now());

    let lastWrite = 0;
    const active = () => {
      const now = Date.now();
      if (now - lastWrite < 5_000) return; // at most one write every 5 seconds
      lastWrite = now;
      write(now);
      if (warned.current !== null) {
        toast.dismiss(warned.current);
        warned.current = null;
      }
    };
    const out = async () => {
      if (done.current) return;
      done.current = true;
      const res = await logOut();
      try {
        localStorage.removeItem(KEY);
      } catch {
        // storage unavailable
      }
      // A full page load, so nothing from the signed-in session stays in memory.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`${res.ok ? res.data.login : '/login'}?idle=1`);
    };
    const check = () => {
      const idle = Date.now() - read();
      if (idle >= IDLE_MS) return void out();
      if (idle >= IDLE_MS - WARN_MS && warned.current === null) {
        warned.current = toast.warning('You will be logged out in 1 minute because you have not been active.', {
          duration: WARN_MS,
          action: { label: 'Stay logged in', onClick: () => { lastWrite = 0; active(); } },
        });
      }
    };
    if (expired) void out();
    for (const e of EVENTS) window.addEventListener(e, active, { passive: true });
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, 10_000);
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, active);
      document.removeEventListener('visibilitychange', check);
      clearInterval(timer);
    };
  }, []);
  return null;
}
