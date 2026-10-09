import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { loginFor } from '@/lib/constants';
import { sendCustomerWelcome } from '@/lib/customer-welcome';
import { sendOnboardingEmails } from '@/lib/restaurant-onboarding';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';

// Email confirmation link target (when "Confirm email" is enabled in Supabase Auth).
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  if (tokenHash && type) {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      // A restaurant that just confirmed its email gets "your application is pending" (or, if it's already
      // approved, the welcome email with its kiosk link).
      // A customer gets the congratulations email with the phone app buttons.
      if (data.user && data.user.user_metadata?.role !== 'restaurant') await sendCustomerWelcome(data.user.id).catch((err) => console.error('customer welcome email:', err));
      if (data.user?.user_metadata?.role === 'restaurant') {
        const { data: r } = await supabaseAdmin().from('restaurants').select('id').eq('owner_id', data.user.id).maybeSingle();
        if (r) await sendOnboardingEmails(r.id);
      }
      return NextResponse.redirect(new URL(`${loginFor(data.user?.user_metadata?.role)}?confirmed=1`, url));
    }
  }
  return NextResponse.redirect(new URL('/login?error=confirmation', url));
}
