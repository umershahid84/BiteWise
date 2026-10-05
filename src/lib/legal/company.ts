import 'server-only';
import { serverEnv } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { renderDocument, type Company } from './documents';

// Company details and live settings (service fee, subscription prices) used in the legal documents.
export async function company(): Promise<Company> {
  const { data } = await supabaseAdmin().from('settings').select('key, value')
    .in('key', ['service_fee_bps', 'subscription_monthly_cents', 'subscription_annual_cents', 'founding_spots']);
  const get = (key: string, fallback: number) => Number(data?.find((r) => r.key === key)?.value ?? fallback);
  return {
    ...serverEnv.legal,
    serviceFeePct: get('service_fee_bps', 500) / 100,
    graceMinutes: serverEnv.pickupGraceMinutes,
    monthlyPrice: get('subscription_monthly_cents', 1500) / 100,
    annualPrice: get('subscription_annual_cents', 15000) / 100,
    foundingSpots: get('founding_spots', 50),
  };
}

export async function legalDocument(id: string) {
  return renderDocument(id, await company());
}
