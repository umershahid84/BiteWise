import { NextResponse } from 'next/server';
import { requireRestaurant } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { signedAgreementPdf } from '@/lib/legal/agreement-pdf';

// The signed-in restaurant's electronically signed Restaurant Partner Agreement (the same PDF as in the welcome email).
export async function GET() {
  try {
    const { restaurant } = await requireRestaurant();
    const { filename, pdf } = await signedAgreementPdf(restaurant.id);
    return new NextResponse(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' },
    });
  } catch (err) {
    const e = err instanceof AppError ? err : new AppError(500, 'Could not create the agreement.');
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
