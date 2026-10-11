'use client';

import { useEffect } from 'react';
import { logOut } from '@/app/actions/auth';

// Logs out once every Bite Wise tab has been closed. Each open tab keeps a heartbeat in localStorage and removes it
// when the tab closes. A page that opens with no other live tab, in a session this browser has seen before, means
// Bite Wise was closed and opened again (or the browser restored the old session), so it logs out. A new session
// (just logged in, or from an email link) is recorded instead. Reloading a tab keeps the session.
const TABS = 'bitewise.tabs';
const SESSION = 'bitewise.session';
const MINE = 'bitewise.tab';
const ALIVE_MS = 90_000; // background tabs only get to run about once a minute

type Tabs = Record<string, number>;
const readTabs = (): Tabs => {
  try {
    return JSON.parse(localStorage.getItem(TABS) ?? '{}') as Tabs;
  } catch {
    return {};
  }
};
const writeTabs = (t: Tabs) => {
  try {
    localStorage.setItem(TABS, JSON.stringify(t));
  } catch {
    // storage unavailable
  }
};

export function TabSession({ sessionId }: { sessionId: string }) {
  useEffect(() => {
    let id: string;
    try {
      id = sessionStorage.getItem(MINE) ?? '';
      const reload = !!id;
      if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem(MINE, id);
      }
      const now = Date.now();
      const others = Object.entries(readTabs()).filter(([k, t]) => k !== id && now - t < ALIVE_MS);
      const known = localStorage.getItem(SESSION) === sessionId;
      if (!reload && !others.length && known) {
        // Bite Wise was closed and opened again: end the old session.
        void logOut().then((res) => {
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          location.assign(`${res.ok ? res.data.login : '/login'}?session=1`);
        });
        return;
      }
      localStorage.setItem(SESSION, sessionId);
    } catch {
      return; // storage unavailable (private window): rely on the browser-session cookies
    }
    let closed = false;
    const beat = () => {
      if (closed) return; // a closing tab must not put itself back
      writeTabs({ ...Object.fromEntries(Object.entries(readTabs()).filter(([, t]) => Date.now() - t < ALIVE_MS)), [id]: Date.now() });
    };
    const shown = () => {
      closed = false; // back from the browser's back/forward cache
      beat();
    };
    const gone = () => {
      closed = true;
      const t = readTabs();
      delete t[id];
      writeTabs(t);
    };
    beat();
    const timer = setInterval(beat, 20_000);
    const visible = () => document.visibilityState === 'visible' && beat();
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pagehide', gone);
    window.addEventListener('pageshow', shown);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('pagehide', gone);
      window.removeEventListener('pageshow', shown);
    };
  }, [sessionId]);
  return null;
}
