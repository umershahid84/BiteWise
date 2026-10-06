import { NextResponse, type NextRequest } from 'next/server';
import * as admin from '@/lib/admin';
import { requireActor } from '@/lib/auth';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { incomePdf } from '@/lib/receipts/pdf';
import { formatDateTime } from '@/lib/receipts/time';

// Downloads from the owner console: CSV (orders, sales tax, income, payouts) and the income report as a PDF
// (?section=all for the whole Income tab, periods or restaurants for one table).
export async function GET(req: NextRequest, ctx: RouteContext<'/api/admin/export/[kind]'>) {
  try {
    await requireActor('admin');
    const { kind } = await ctx.params;
    const p = req.nextUrl.searchParams;
    if (kind === 'income-pdf') {
      const x = await admin.income(p);
      const section = admin.incomeSection(p);
      const pdf = await incomePdf(x, section, { generatedAt: formatDateTime(new Date().toISOString(), serverEnv.timeZone), note: admin.INCOME_NOTE });
      const what = section === 'restaurants' ? 'income-by-restaurant' : section === 'periods' ? `income-by-${x.by}` : 'income-report';
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="BiteWise-${what}-${x.range.from}-to-${x.range.to}.pdf"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }
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
    if (!(err instanceof AppError)) console.error(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
