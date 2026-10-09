'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { serverEnv } from '@/lib/env';
import { checkEmailDomain } from '@/lib/email-domain';
import { confirmationEmail, sendsOwnConfirmation } from '@/lib/email/confirmation';
import { sendEmail } from '@/lib/email/send';
import { requiredDocuments } from '@/lib/legal/documents';
import { getViewer } from '@/lib/auth';
import { homeFor, loginFor, PORTAL_NAMES, portalFor } from '@/lib/constants';
import { action, AppError, fromDb } from '@/lib/errors';
import { sendCustomerWelcome } from '@/lib/customer-welcome';
import { requestPasswordReset, resetPassword } from '@/lib/password-reset';
import { locateRestaurant } from '@/lib/restaurant-location';
import { refreshRestaurantTax } from '@/lib/restaurant-tax';
import { sendOnboardingEmails } from '@/lib/restaurant-onboarding';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { parse, passwordSchema, signupSchema } from '@/lib/validate';
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

const CONFIRM_URL = () => `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/auth/confirm`;

// Emails the confirmation link. If the email can't be sent, Supabase sends its own as a fallback.
async function sendConfirmation(email: string, tokenHash: string, meta: Record<string, unknown> | undefined) {
  const restaurant = meta?.restaurant as { name?: string } | undefined;
  const sent = await sendEmail({
    to: email,
    ...confirmationEmail({ email, tokenHash, username: meta?.username as string | undefined, role: meta?.role as string | undefined, restaurant: restaurant?.name }),
  }).catch((err) => {
    console.error('confirmation email:', err instanceof Error ? err.message : err);
    return false;
  });
  if (!sent) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: CONFIRM_URL() } });
    if (error) console.error('confirmation email (Supabase):', error.message);
  }
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
// A new restaurant's sales tax rate comes from its address (the scheduled jobs retry if the lookup fails now).
async function lookUpTax(ownerId: string) {
  try {
    const { data: r } = await supabaseAdmin().from('restaurants').select('id').eq('owner_id', ownerId).maybeSingle();
    if (r) await refreshRestaurantTax(r.id);
  } catch (err) {
    console.warn('tax rate lookup failed:', err instanceof Error ? err.message : err);
  }
}

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
    const metadata = {
      username: data.username,
      role: data.role,
      accepted_terms: data.acceptedTerms,
      restaurant: data.role === 'restaurant' ? data.restaurant : undefined,
      ip,
      user_agent: userAgent,
    };
    const signupError = (error: { message: string }) => {
      if (/already registered|already exists/i.test(error.message)) return new AppError(409, 'An account with this email already exists.');
      return new AppError(400, error.message.includes('Database error') ? 'We could not create your account. Please check your details.' : error.message);
    };

    // The app sends the Bite Wise confirmation email itself (see src/lib/email/confirmation.ts).
    if (await sendsOwnConfirmation()) {
      const { data: link, error } = await supabaseAdmin().auth.admin.generateLink({
        type: 'signup', email: data.email, password: data.password, options: { data: metadata, redirectTo: CONFIRM_URL() },
      });
      if (error) throw signupError(error);
      if (data.role === 'restaurant') await lookUpTax(link.user.id);
      await sendConfirmation(data.email, link.properties.hashed_token, link.user.user_metadata);
      return { needsConfirmation: true, next: homeFor(data.role) };
    }

    const supabase = await supabaseServer();
    const { data: res, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: { emailRedirectTo: CONFIRM_URL(), data: metadata },
    });
    if (error) throw signupError(error);
    if (data.role === 'restaurant' && res.user) await lookUpTax(res.user.id);
    // With email confirmation off, the email counts as confirmed at once: send the restaurant's onboarding email now.
    if (res.session && data.role === 'customer' && res.user) await sendCustomerWelcome(res.user.id).catch((err) => console.error('customer welcome email:', err));
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

const loginSchema = z.object({
  login: z.string().trim().min(1, 'Enter your email or user name.'),
  password: z.string().min(1, 'Enter your password.'),
  // The log-in page used: customers, restaurant partners (owners and staff) and admins each have their own.
  portal: z.enum(['customer', 'restaurant', 'admin']).optional(),
});

// Log in with an email address or a user name.
export async function signIn(input: unknown) {
  return action(async () => {
    const { login, password, portal } = parse(loginSchema, input);
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
        const { data: p } = await supabaseAdmin().from('profiles').select('status, suspended_until, role').eq('email', email).maybeSingle();
        if (p?.status === 'banned') throw new AppError(403, BANNED);
        if (p?.role === 'staff') throw new AppError(403, 'Your restaurant owner has paused your account. Ask them to turn it back on.');
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
    // Staff can't log in while their restaurant is banned or deleted.
    if (profile.role === 'staff') {
      const { data: job } = await supabaseAdmin().from('restaurant_staff').select('restaurants(status)').eq('user_id', data.user.id).maybeSingle();
      const st = job?.restaurants?.status;
      if (!st || st === 'banned' || st === 'deleted') {
        await supabase.auth.signOut();
        throw new AppError(403, 'This restaurant is no longer on Bite Wise, so its staff accounts are closed.');
      }
    }
    // An account logging in on another kind of account's page is sent to its own page.
    const own = portalFor(profile.role);
    if (portal && own !== portal) {
      await supabase.auth.signOut();
      throw new AppError(403, `This log-in page is for ${PORTAL_NAMES[portal]} accounts. Please use the ${PORTAL_NAMES[own]} log-in page.`, `portal:${own}`);
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
    if (await sendsOwnConfirmation()) {
      const { data: profile } = await supabaseAdmin().from('profiles').select('id').eq('email', email).maybeSingle();
      if (!profile) return null;
      // One email a minute per account, as Supabase does.
      const { data: user } = await supabaseAdmin().auth.admin.getUserById(profile.id);
      if (user.user?.email_confirmed_at) return null;
      const last = user.user?.confirmation_sent_at ? Date.parse(user.user.confirmation_sent_at) : 0;
      if (Date.now() - last < 60_000) throw new AppError(429, 'An email was sent very recently. Please wait a minute and try again.');
      // Gives a new link for an account that isn't confirmed yet; a confirmed one answers "email_exists".
      const { data: link, error } = await supabaseAdmin().auth.admin.generateLink({
        type: 'signup', email, password: undefined as unknown as string, // existing account: its password stays as it is
        options: { redirectTo: CONFIRM_URL() },
      });
      if (error) {
        if (error.code !== 'email_exists') console.error('resend confirmation:', error.message);
        return null;
      }
      await sendConfirmation(email, link.properties.hashed_token, link.user.user_metadata);
      return null;
    }
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: CONFIRM_URL() } });
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

// ---------------------------------------------------------------- forgot password (src/lib/password-reset.ts)

export async function forgotPassword(input: unknown) {
  return action(async () => {
    const { login } = parse(z.object({ login: z.string().trim().min(3, 'Enter your email address.').max(254) }), input);
    await requestPasswordReset(login);
    return null;
  });
}

const resetSchema = z.object({
  login: z.string().trim().min(3).max(254),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
  password: passwordSchema,
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, { message: 'The two passwords don\'t match.', path: ['confirm'] });

export async function resetPasswordWithCode(input: unknown) {
  return action(async () => {
    const d = parse(resetSchema, input);
    const portal = await resetPassword(d.login, d.code, d.password);
    return { portal };
  });
}

// Log out without leaving the page (the idle timer); returns the account's log-in page.
export async function logOut() {
  return action(async () => {
    const viewer = await getViewer();
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
    return { login: loginFor(viewer?.role) };
  });
}
