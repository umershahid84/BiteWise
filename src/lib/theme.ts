// Each part of Bite Wise has its own look (src/app/globals.css): customers, restaurants (portal and kiosk) and the
// admin team. The address decides which. Each look comes in light and dark: by default customers and the admin team
// get light and restaurants dark, and anyone can pick Light, Dark or "Match my device" (saved in a cookie).
export type Theme = 'customer' | 'restaurant' | 'admin';
export type Mode = 'light' | 'dark';
export type ModePref = Mode | 'system';

export const MODE_COOKIE = 'bw-mode';

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

export function themeForPath(path: string): Theme {
  if (under(path, '/admin')) return 'admin';
  if (under(path, '/restaurant') || under(path, '/kiosk')) return 'restaurant';
  return 'customer';
}

export const defaultMode = (theme: Theme): Mode => (theme === 'restaurant' ? 'dark' : 'light');

export const parseModePref = (v: string | undefined | null): ModePref | null => (v === 'light' || v === 'dark' || v === 'system' ? v : null);

// Server side: the mode for the first paint (Match my device is settled in the browser by MODE_SCRIPT).
export const modeFor = (theme: Theme, pref: ModePref | null): Mode => (pref === 'light' || pref === 'dark' ? pref : defaultMode(theme));

// Browser side: the saved choice, and the mode it gives for a look.
export function savedModePref(): ModePref | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${MODE_COOKIE}=([^;]*)`));
  return parseModePref(m?.[1]);
}
export function resolveMode(theme: Theme, pref: ModePref | null): Mode {
  if (pref === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return modeFor(theme, pref);
}
// Switches the page to a look (and its light or dark version).
export function applyLook(theme: Theme, pref: ModePref | null = savedModePref()) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.mode = resolveMode(theme, pref);
}
export function saveModePref(pref: ModePref) {
  document.cookie = `${MODE_COOKIE}=${pref}; path=/; max-age=${60 * 60 * 24 * 400}; samesite=lax`;
}

// Runs before the first paint, so "Match my device" never flashes the wrong mode.
export const MODE_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${MODE_COOKIE}=system(?:;|$)/);if(m){document.documentElement.dataset.mode=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}}catch(e){}})()`;
