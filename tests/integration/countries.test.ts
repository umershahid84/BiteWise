// The United States and Canada: people accept the documents of their country, and Canadian restaurants are taxed by
// province.
import { describe, expect, it } from 'vitest';
import { LEGAL_VERSION } from '@/lib/legal/documents';
import { refreshRestaurantTax } from '@/lib/restaurant-tax';
import { admin, signUp, supabaseAvailable } from '../support/db';

const available = await supabaseAvailable();
const db = () => admin();
const ca = (role: 'customer' | 'restaurant') =>
  role === 'customer'
    ? { 'customer-terms-ca': LEGAL_VERSION, 'privacy-ca': LEGAL_VERSION }
    : { 'restaurant-agreement-ca': LEGAL_VERSION, 'privacy-ca': LEGAL_VERSION };

describe.skipIf(!available)('US and Canada sign-ups', () => {
  it('signs a Canadian customer up under the Canadian terms', async () => {
    const c = await signUp('customer', { country: 'CA', region: 'ON', city: 'Toronto', accepted_terms: ca('customer') });
    const p = (await db().from('profiles').select('country, region, city').eq('id', c.id).single()).data!;
    expect(p).toEqual({ country: 'CA', region: 'ON', city: 'Toronto' });
    const docs = (await db().from('terms_acceptances').select('document').eq('user_id', c.id)).data!.map((d) => d.document).sort();
    expect(docs).toEqual(['customer-terms-ca', 'privacy-ca']);
    // Nothing pending: the US documents don't apply to them.
    expect((await c.client.rpc('pending_terms')).data).toEqual([]);
  });

  it('refuses a Canadian sign-up that accepted the US terms instead', async () => {
    await expect(signUp('customer', { country: 'CA', region: 'BC', city: 'Vancouver' })).rejects.toThrow(/sign up failed/);
  });

  it('creates a Canadian restaurant with its province and the provincial sales tax', async () => {
    const r = await signUp('restaurant', {
      country: 'CA', region: 'ON', city: 'Toronto', accepted_terms: ca('restaurant'),
      restaurant: { name: 'Test Kitchen Toronto', address: '290 Bremner Blvd', city: 'Toronto', state: 'ON', zip: 'M5V 3L9', country: 'CA' },
    });
    const row = (await db().from('restaurants').select('id, country, state, zip').eq('owner_id', r.id).single()).data!;
    expect(row).toMatchObject({ country: 'CA', state: 'ON', zip: 'M5V 3L9' });
    const tax = await refreshRestaurantTax(row.id, { force: true });
    expect(tax).toMatchObject({ rateBps: 1300, accuracy: 'address' });
  });
});
