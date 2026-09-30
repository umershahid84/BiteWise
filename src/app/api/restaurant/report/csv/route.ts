import { NextResponse, type NextRequest } from 'next/server';
import { AppError } from '@/lib/errors';
import { reportCsv } from '@/lib/receipts/data';
import { restaurantReport } from '@/lib/receipts/report-access';

export async function GET(req: NextRequest) {
  try {
    const rep = await restaurantReport(req.nextUrl.searchParams.get('date'));
    return new NextResponse(reportCsv(rep), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="RescueBites-report-${rep.date}.csv"`, 'Cache-Control': 'private, no-store' },
    });
  } catch (err) {
    const e = err instanceof AppError ? err : new AppError(500, 'Could not create the report.');
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
