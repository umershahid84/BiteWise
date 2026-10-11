import type { Metadata } from 'next';
import { AccountPanel } from '@/components/account/account-panel';
import { requirePageViewer } from '@/lib/auth';
import { paymentConfigs } from '@/lib/env';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Account' };

export default async function AccountPage() {
  const viewer = await requirePageViewer('customer');
  const supabase = await supabaseServer();
  const { data: profile } = await supabase.from('profiles').select('postal_code').eq('id', viewer.id).maybeSingle();
  return (
    <main className="container-page max-w-[900px] py-8">
      <h1 className="text-3xl font-extrabold">Account</h1>
      <AccountPanel
        username={viewer.username}
        email={viewer.email}
        country={viewer.country}
        postalCode={profile?.postal_code ?? ''}
        payments={paymentConfigs()}
      />
    </main>
  );
}
