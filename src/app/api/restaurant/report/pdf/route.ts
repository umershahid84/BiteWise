import { NextResponse, type NextRequest } from 'next/server';
import { AppError } from '@/lib/errors';
import { reportPdf } from '@/lib/receipts/pdf';
import { restaurantReport } from '@/lib/receipts/report-access';

export async function GET(req: NextRequest) {
  try {
    const rep = await restaurantReport(req.nextUrl.searchParams.get('date'));
    const disposition = req.nextUrl.searchParams.has('inline') ? 'inline' : 'attachment';
    return new NextResponse(new Uint8Array(await reportPdf(rep)), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${disposition}; filename="BiteWise-report-${rep.date}.pdf"`, 'Cache-Control': 'private, no-store' },
    });
  } catch (err) {
    const e = err instanceof AppError ? err : new AppError(500, 'Could not create the report.');
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
