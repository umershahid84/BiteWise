'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { serverEnv } from '@/lib/env';
import { checkEmailDomain } from '@/lib/email-domain';
import { requiredDocuments } from '@/lib/legal/documents';
import { getViewer } from '@/lib/auth';
import { homeFor } from '@/lib/constants';
import { action, AppError, fromDb } from '@/lib/errors';
import { locateRestaurant } from '@/lib/restaurant-location';
import { sendOnboardingEmails } from '@/lib/restaurant-onboarding';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { parse, signupSchema } from '@/lib/validate';
import { z } from 'zod';

async function requestInfo() {
  const h = await headers();
  return {
    ip: (h.get('x-forwarded-for') ?? '').split(',')[0].trim().slice(0, 64),
    userAgent: (h.get('user-agent') ?? '').slice(0, 300),
  };
}

function checkSignup(input: unknown) {
  const data = parse(signupSchema, input);
  if (data.role === 'restaurant' && !data.restaurant) throw new AppError(400, 'Please enter your restaurant details.');
  return data;
}

// The email must be a real, permanent address (see src/lib/email-domain.ts), and not already used: banned accounts
// keep their email, so a banned person can't sign up again with it.
async function assertAvailable(email: string, username: string) {
  const admin = supabaseAdmin();
  const [byEmail, byName, domain] = await Promise.all([
    admin.from('profiles').select('id, status').eq('email', email).maybeSingle(),
    admin.from('profiles').select('id').eq('username', username).maybeSingle(),
    checkEmailDomain(email),
  ]);
  if (byEmail.data?.status === 'banned') throw new AppError(403, 'This email address can\'t be used to create a Bite Wise account.');
  if (byEmail.data) throw new AppError(409, 'An account with this email already exists.');
  if (!domain.ok) throw new AppError(400, domain.reason);
  if (byName.data) throw new AppError(409, 'That user name is taken.');
}

const BANNED = 'This account has been permanently closed for breaking the Bite Wise terms. Contact Bite Wise support if you think this is a mistake.';

// Checks the sign-up form before the agreement is shown, without creating anything.
export async function validateSignup(input: unknown) {
  return action(async () => {
    const data = checkSignup(input);
    await assertAvailable(data.email, data.username);
    return { documents: requiredDocuments(data.role) };
  });
}

// Creates the account. It is only created when the current version of every required legal
// document was accepted (checked here and again by the database trigger). Declining creates nothing.
export async function signUp(input: unknown) {
  return action(async () => {
    const data = checkSignup(input);
    const missing = requiredDocuments(data.role).filter((d) => data.acceptedTerms?.[d.id] !== d.version);
    if (missing.length) {
      throw new AppError(400, `To create an account you must accept the ${missing.map((d) => d.title).join(' and ')}.`, 'terms_required');
    }
    await assertAvailable(data.email, data.username);
    const { ip, userAgent } = await requestInfo();
    // Put the restaurant on the map at its street address (the database falls back to the ZIP code's center).
    if (data.restaurant && (data.restaurant.lat === null || data.restaurant.lng === null)) {
      const spot = await locateRestaurant(data.restaurant);
      if (spot?.source === 'address') data.restaurant = { ...data.restaurant, lat: spot.lat, lng: spot.lng };
    }
    const supabase = await supabaseServer();
    const { data: res, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/auth/confirm`,
        data: {
          username: data.username,
          role: data.role,
          accepted_terms: data.acceptedTerms,
          restaurant: data.role === 'restaurant' ? data.restaurant : undefined,
          ip,
          user_agent: userAgent,
        },
      },
    });
    if (error) {
      if (/already registered|already exists/i.test(error.message)) throw new AppError(409, 'An account with this email already exists.');
      throw new AppError(400, error.message.includes('Database error') ? 'We could not create your account. Please check your details.' : error.message);
    }
    // With email confirmation off, the email counts as confirmed at once: send the restaurant's onboarding email now.
    if (res.session && data.role === 'restaurant' && res.user) {
      const { data: r } = await supabaseAdmin().from('restaurants').select('id').eq('owner_id', res.user.id).maybeSingle();
      if (r) await sendOnboardingEmails(r.id);
    }
    // With email confirmation on (recommended in production) there is no session until the link is clicked.
    return { needsConfirmation: !res.session, next: homeFor(data.role) };
  });
}

const untilText = (until: string | null | undefined) =>
  until ? ` until ${new Date(until).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: serverEnv.timeZone })}` : '';

const loginSchema = z.object({ login: z.string().trim().min(1, 'Enter your email or user name.'), password: z.string().min(1, 'Enter your password.') });

// Log in with an email address or a user name.
export async function signIn(input: unknown) {
  return action(async () => {
    const { login, password } = parse(loginSchema, input);
    let email = login.toLowerCase();
    if (!login.includes('@')) {
      const { data } = await supabaseAdmin().from('profiles').select('email').eq('username', login).maybeSingle();
      email = data?.email ?? `${login}@invalid.local`;
    }
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.status === 429) throw new AppError(429, 'Too many attempts. Please wait a few minutes and try again.');
      if (/banned/i.test(error.message)) {
        // Supabase calls suspensions and bans both "banned"; the profile says which.
        const { data: p } = await supabaseAdmin().from('profiles').select('status, suspended_until').eq('email', email).maybeSingle();
        if (p?.status === 'banned') throw new AppError(403, BANNED);
        throw new AppError(403, `This account has been suspended${untilText(p?.suspended_until)}. Contact Bite Wise support for help.`);
      }
      if (/not confirmed/i.test(error.message)) throw new AppError(403, 'Please confirm your email address first. Check your inbox for the link.');
      throw new AppError(401, 'Email/user name or password is incorrect.');
    }
    const { data: profile } = await supabase.from('profiles').select('role, status, suspended_until').eq('id', data.user.id).single();
    if (profile?.status === 'suspended' && profile.suspended_until && new Date(profile.suspended_until) <= new Date()) {
      // The suspension is over (the sweep job normally reactivates the account first).
      await supabaseAdmin().from('profiles').update({ status: 'active', suspended_until: null }).eq('id', data.user.id);
      profile.status = 'active';
    }
    if (!profile || profile.status !== 'active') {
      await supabase.auth.signOut();
      if (profile?.status === 'banned') throw new AppError(403, BANNED);
      throw new AppError(403, `This account has been suspended${untilText(profile?.status === 'suspended' ? profile.suspended_until : null)}. Contact Bite Wise support for help.`);
    }
    return { next: homeFor(profile.role) };
  });
}

// Sends the sign-up confirmation email again. Takes an email address or a user name (from the log-in form).
// The answer is the same whether or not the account exists, so it can't be used to look up accounts.
export async function resendConfirmation(input: unknown) {
  return action(async () => {
    const { login } = parse(z.object({ login: z.string().trim().min(3, 'Enter your email or user name.').max(254) }), input);
    let email = login.toLowerCase();
    if (!login.includes('@')) {
      const { data } = await supabaseAdmin().from('profiles').select('email').eq('username', login).maybeSingle();
      if (!data) return null;
      email = data.email;
    }
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/auth/confirm` },
    });
    if (error?.status === 429) throw new AppError(429, 'An email was sent very recently. Please wait a minute and try again.');
    if (error) console.error('resend confirmation:', error.message);
    return null;
  });
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect('/');
}

// Existing users accepting updated terms. Declining signs them out (see TermsGate).
export async function acceptUpdatedTerms(accepted: Record<string, string>) {
  return action(async () => {
    const viewer = await getViewer();
    if (!viewer) throw new AppError(401, 'Please log in.');
    const { ip, userAgent } = await requestInfo();
    const supabase = await supabaseServer();
    const err = fromDb((await supabase.rpc('accept_terms', { p_accepted: accepted, p_ip: ip, p_user_agent: userAgent })).error);
    if (err) throw err;
    return null;
  });
}
