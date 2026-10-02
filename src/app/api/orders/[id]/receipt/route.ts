import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth';
import { receiptData } from '@/lib/receipts/data';
import { receiptPdf } from '@/lib/receipts/pdf';
import { supabaseServer } from '@/lib/supabase/server';

// Receipt PDF (80 mm POS format) for the customer who placed the order, or for admins (RLS decides).
export async function GET(req: NextRequest, ctx: RouteContext<'/api/orders/[id]/receipt'>) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  const supabase = await supabaseServer();
  const { data: order } = await supabase.from('orders').select('*').eq('id', Number(id)).maybeSingle();
  if (!order || (viewer.role !== 'admin' && order.user_id !== viewer.id)) {
    return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  }
  const rc = await receiptData(order);
  const pdf = await receiptPdf(rc);
  const disposition = req.nextUrl.searchParams.has('inline') ? 'inline' : 'attachment';
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="BiteWise-receipt-${rc.receiptNumber}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
