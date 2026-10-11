import { NextResponse, type NextRequest } from 'next/server';
import { company } from '@/lib/legal/company';
import { renderDocument, requiredIds } from '@/lib/legal/documents';

// Documents a role must accept in a country (US or CA), with their full text (for the accept/decline dialog).
export async function GET(req: NextRequest) {
  const role = req.nextUrl.searchParams.get('role') === 'restaurant' ? 'restaurant' : 'customer';
  const country = req.nextUrl.searchParams.get('country') === 'CA' ? 'CA' : 'US';
  const c = await company();
  return NextResponse.json({ documents: requiredIds(role, country).map((id) => renderDocument(id, c)) });
}
