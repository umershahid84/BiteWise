import { NextResponse, type NextRequest } from 'next/server';
import * as admin from '@/lib/admin';
import { requireActor } from '@/lib/auth';
import { paymentMode } from '@/lib/env';
import { AppError } from '@/lib/errors';

// Read-only JSON for the owner console. Every request is checked for an admin session.
const RESOURCES: Record<string, (p: URLSearchParams) => Promise<unknown>> = {
  overview: admin.overview,
  restaurants: admin.restaurants,
  users: admin.users,
  orders: admin.orders,
  refunds: (p) => admin.orderRefunds(Number(p.get('orderId'))),
  offers: () => admin.liveOffers(),
  payouts: () => admin.payouts(),
  plans: () => admin.plans(),
  tax: admin.tax,
  settings: async () => ({ settings: await admin.settings(), paymentMode: paymentMode() }),
  audit: () => admin.audit(),
};

export async function GET(req: NextRequest, ctx: RouteContext<'/api/admin/[resource]'>) {
  try {
    await requireActor('admin');
    const { resource } = await ctx.params;
    const load = RESOURCES[resource];
    if (!load) throw new AppError(404, 'Not found.');
    return NextResponse.json(await load(req.nextUrl.searchParams), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    const e = err instanceof AppError ? err : new AppError(500, 'Something went wrong.');
    if (!(err instanceof AppError)) console.error(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
