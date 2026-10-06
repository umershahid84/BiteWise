import { NextResponse, type NextRequest } from 'next/server';
import * as admin from '@/lib/admin';
import { requireActor } from '@/lib/auth';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { cellText, hasReport, report, reportCsv } from '@/lib/exports';
import { incomePdf, listReportPdf } from '@/lib/receipts/pdf';
import { formatDateTime } from '@/lib/receipts/time';

// Downloads from the owner console, as CSV or PDF (?format=pdf):
//   restaurants, users, orders, payouts, tax, audit: the tab with its current filters (src/lib/exports.ts); ?section=
//   <table> for one of its tables;
//   income (CSV) and income-pdf: the Income tab (?section=all, periods or restaurants).
const pdfResponse = (pdf: Buffer, name: string) =>
  new NextResponse(new Uint8Array(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' },
  });
// The byte order mark makes Excel read the file as UTF-8 (so "•", "–" and accents show correctly).
const csvResponse = (csv: string, name: string) =>
  new NextResponse(`\uFEFF${csv}`, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' },
  });

export async function GET(req: NextRequest, ctx: RouteContext<'/api/admin/export/[kind]'>) {
  try {
    await requireActor('admin');
    const { kind } = await ctx.params;
    const p = req.nextUrl.searchParams;
    const generatedAt = formatDateTime(new Date().toISOString(), serverEnv.timeZone);
    if (hasReport(kind)) {
      const { report: r } = await report(kind, p);
      return p.get('format') === 'pdf'
        ? pdfResponse(await listReportPdf(r, { generatedAt, text: (c) => cellText(c, false) }), `BiteWise-${r.file}.pdf`)
        : csvResponse(reportCsv(r), `BiteWise-${r.file}.csv`);
    }
    if (kind === 'income') {
      const file = await admin.incomeCsv(p);
      return csvResponse(file.csv, file.name);
    }
    if (kind === 'income-pdf') {
      const x = await admin.income(p);
      const section = admin.incomeSection(p);
      const pdf = await incomePdf(x, section, { generatedAt, note: admin.INCOME_NOTE });
      const what = section === 'restaurants' ? 'income-by-restaurant' : section === 'periods' ? `income-by-${x.by}` : 'income-report';
      return pdfResponse(pdf, `BiteWise-${what}-${x.range.from}-to-${x.range.to}.pdf`);
    }
    throw new AppError(404, 'Not found.');
  } catch (err) {
    const e = err instanceof AppError ? err : new AppError(500, 'Something went wrong.');
    if (!(err instanceof AppError)) console.error(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
