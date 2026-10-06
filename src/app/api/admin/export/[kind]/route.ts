import { NextResponse, type NextRequest } from 'next/server';
import * as admin from '@/lib/admin';
import { requireActor } from '@/lib/auth';
import { AppError } from '@/lib/errors';

// CSV exports: orders, sales tax, income and payouts.
export async function GET(req: NextRequest, ctx: RouteContext<'/api/admin/export/[kind]'>) {
  try {
    await requireActor('admin');
    const { kind } = await ctx.params;
    const p = req.nextUrl.searchParams;
    const file =
      kind === 'orders' ? await admin.ordersCsv(p)
        : kind === 'tax' ? await admin.taxCsv(p)
          : kind === 'income' ? await admin.incomeCsv(p)
          : kind === 'payouts' ? { name: 'BiteWise-payouts.csv', csv: await admin.payoutsCsv() }
            : null;
    if (!file) throw new AppError(404, 'Not found.');
    return new NextResponse(file.csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file.name}"`, 'Cache-Control': 'private, no-store' },
    });
  } catch (err) {
    const e = err instanceof AppError ? err : new AppError(500, 'Something went wrong.');
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
