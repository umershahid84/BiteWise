// Each part of Bite Wise has its own look (src/app/globals.css): customers, restaurants (portal and kiosk) and the
// admin team. The address decides which.
export type Theme = 'customer' | 'restaurant' | 'admin';

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

export function themeForPath(path: string): Theme {
  if (under(path, '/admin')) return 'admin';
  if (under(path, '/restaurant') || under(path, '/kiosk')) return 'restaurant';
  return 'customer';
}
