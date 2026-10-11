import type { Database } from '@/lib/database.types';
import type { MapConfig } from '@/components/offers/types';

export type Restaurant = Database['public']['Tables']['restaurants']['Row'];
export type MenuItem = Database['public']['Tables']['menu_items']['Row'];
export type Offer = Database['public']['Tables']['offers']['Row'];
export type Ctx = { restaurant: Restaurant; serviceFeeBps: number; map: MapConfig; paymentMode: 'stripe' | 'mock' | 'off' };
