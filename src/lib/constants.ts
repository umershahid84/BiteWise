import type { Database } from '@/lib/database.types';

export type OfferReason = Database['public']['Enums']['offer_reason'];
export type OrderStatus = Database['public']['Enums']['order_status'];
export type Role = Database['public']['Enums']['user_role'];

export const OFFER_REASONS: Record<OfferReason, string> = {
  wrong_order: 'Wrong order',
  delayed_order: 'Delayed delivery',
  unclaimed_order: 'Order never picked up',
  overproduction: 'Made too much',
  end_of_day: 'End-of-day surplus',
  other: 'Other',
};

// How long the owner console can suspend an account for, in days.
export const SUSPENSION_DAYS = [5, 10, 15, 20, 30] as const;

export const DIETARY_TAGS = ['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free', 'halal', 'kosher', 'spicy'] as const;

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Processing',
  reserved: 'Awaiting pickup',
  picked_up: 'Picked up',
  cancelled: 'Cancelled',
  expired: 'Not picked up',
  failed: 'Payment failed',
};

// Cards can't be charged less than this; customers apply more or less credit instead.
export const MIN_CARD_CHARGE_CENTS = 50;

export const homeFor = (role: Role | null | undefined) =>
  role === 'admin' || role === 'support' ? '/admin' : role === 'restaurant' || role === 'staff' ? '/restaurant' : '/offers';

// Customers, restaurant owners and restaurant staff share one log-in page; the admin team has its own.
export type Portal = 'main' | 'admin';
export const portalFor = (role: Role | null | undefined): Portal => (role === 'admin' || role === 'support' ? 'admin' : 'main');
export const LOGIN_PATH: Record<Portal, string> = { main: '/login', admin: '/admin/login' };
export const SIGNUP_PATH = { customer: '/signup', restaurant: '/restaurant/signup' } as const;
export const loginFor = (role: Role | null | undefined) => LOGIN_PATH[portalFor(role)];
// The log-in page for a path that needs an account (/admin/... has its own).
export const loginForPath = (path: string) => (path === '/admin' || path.startsWith('/admin/') ? LOGIN_PATH.admin : LOGIN_PATH.main);
export const PORTAL_NAMES: Record<Portal, string> = { main: 'customer and restaurant', admin: 'admin' };

const CUISINE_EMOJI: Record<string, string> = {
  seafood: '🦐', salvadoran: '🫓', bbq: '🍖', vietnamese: '🍜', bakery: '🥐', mexican: '🌮', pizza: '🍕', indian: '🍛',
  hawaiian: '🐟', japanese: '🍣', thai: '🍲', chinese: '🥡', italian: '🍝', burgers: '🍔', american: '🍔', korean: '🍱',
  mediterranean: '🥙', cafe: '☕', dessert: '🍰', salad: '🥗',
};
export const cuisineEmoji = (c?: string | null) => CUISINE_EMOJI[String(c ?? '').toLowerCase()] ?? '🍽️';

const CUISINE_HUE: Record<string, number> = {
  seafood: 200, salvadoran: 45, bbq: 15, vietnamese: 28, bakery: 40, mexican: 12, pizza: 0, indian: 30, hawaiian: 190,
  japanese: 340, thai: 60, chinese: 355, italian: 110, burgers: 20, american: 20, korean: 320, mediterranean: 80,
  cafe: 35, dessert: 300, salad: 100,
};
export const cuisineHue = (c?: string | null) => CUISINE_HUE[String(c ?? '').toLowerCase()] ?? 150;

// What to show for an offer: an active offer with nothing left is "Sold out" (it stays active in the database, so a
// cancelled order can put the food back on sale).
export const offerStatus = (o: { status: string; quantity_available: number }) =>
  o.status === 'active' && o.quantity_available <= 0 ? 'sold_out' : o.status;

// Stripe accounts "connected" while the site ran without Stripe keys (test payments) don't exist at Stripe. Once real
// keys are set they count as not connected, so the restaurant connects its real Stripe account.
export const isTestStripeAccount = (id: string | null | undefined) => !!id && id.startsWith('acct_mock_');

// The owner console: full admins see everything; admin employees ('support') only these tabs.
export const SUPPORT_TABS = ['alerts', 'restaurants', 'users', 'orders', 'offers'] as const;
