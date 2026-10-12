// Display helpers shared by server and client code.

// US dollars show as "$12.50", Canadian dollars as "CA$12.50" (orders are in the restaurant's currency).
export const money = (cents: number, currency?: string | null) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: currency?.toLowerCase() === 'cad' ? 'CAD' : 'USD' });
export const currencyOf = (country?: string | null) => (country === 'CA' ? 'cad' : 'usd');

// 1035 -> "10.35%", 500 -> "5%"
export const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function fmtDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export const fmtDateTime = (iso: string) => `${fmtDay(iso)}, ${fmtTime(iso)}`;

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

// Time left on a discard timer: "2h 05m", "12m", "4:09", or "Expired".
export function timeLeft(iso: string, now = Date.now()) {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return 'Expired';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m >= 10) return `${m}m`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export const dollarsToCents = (value: string | number) => Math.round(Number(String(value).replace(/[$,\s]/g, '')) * 100);

// Distances in the customer's own units: miles in the United States, kilometres in Canada ("0.4 mi", "0.6 km").
export const KM_PER_MILE = 1.609344;
export type DistanceUnit = 'mi' | 'km';
export const distanceUnit = (country?: string | null): DistanceUnit => (country === 'CA' ? 'km' : 'mi');
export const distanceText = (miles: number, unit: DistanceUnit) =>
  `${(unit === 'km' ? miles * KM_PER_MILE : miles).toFixed(1)} ${unit}`;
