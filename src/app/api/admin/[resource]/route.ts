import { NextResponse, type NextRequest } from 'next/server';
import * as admin from '@/lib/admin';
import { requireAdmin } from '@/lib/auth';
import { listTeam } from '@/lib/team';
import { paymentMode } from '@/lib/env';
import { AppError } from '@/lib/errors';

// Read-only JSON for the owner console. Every request is checked for an admin (or admin employee) session.
const RESOURCES: Record<string, (p: URLSearchParams) => Promise<unknown>> = {
  overview: admin.overview,
  restaurants: admin.restaurants,
  users: admin.users,
  orders: admin.orders,
  refunds: (p) => admin.orderRefunds(Number(p.get('orderId'))),
  offers: () => admin.liveOffers(),
  payouts: async () => ({ ...(await admin.payouts()), paymentMode: paymentMode() }),
  plans: () => admin.plans(),
  tax: admin.tax,
  settings: async () => ({ settings: await admin.settings(), paymentMode: paymentMode() }),
  audit: () => admin.audit(),
  alerts: admin.alerts,
  income: admin.income,
  team: () => listTeam(),
};
// What admin employees ('support') can read: their tabs (not the admin team's accounts).
const SUPPORT = new Set(['restaurants', 'users', 'orders', 'refunds', 'offers', 'alerts']);

export async function GET(req: NextRequest, ctx: RouteContext<'/api/admin/[resource]'>) {
  try {
    const me = await requireAdmin('support');
    const { resource } = await ctx.params;
    const load = RESOURCES[resource];
    if (!load) throw new AppError(404, 'Not found.');
    if (me.role !== 'admin') {
      const role = req.nextUrl.searchParams.get('role');
      if (!SUPPORT.has(resource) || (resource === 'users' && (role === 'admin' || role === 'support'))) throw new AppError(403, 'Only an admin can see this.');
    }
    return NextResponse.json(await load(req.nextUrl.searchParams), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    const e = err instanceof AppError ? err : new AppError(500, 'Something went wrong.');
    if (!(err instanceof AppError)) console.error(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
