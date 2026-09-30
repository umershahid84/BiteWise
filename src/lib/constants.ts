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
  role === 'admin' ? '/admin' : role === 'restaurant' ? '/restaurant' : '/offers';

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
