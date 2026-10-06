import 'server-only';
import { createHash } from 'node:crypto';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { serverEnv } from '@/lib/env';
import { must } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { company } from './company';
import { renderDocument } from './documents';
import { displayPhone } from '@/lib/phone';

// The restaurant's copy of its Restaurant Partner Agreement as a PDF: the full text, then an electronic signature
// record built from the acceptance stored at sign-up (who, when, from which IP and device, which version) and
// Bite Wise's acceptance on approval. Sent with the welcome email and downloadable from the dashboard.

const FONT_DIR = path.join(process.cwd(), 'assets', 'pdf-fonts');
const LOGO = path.join(process.cwd(), 'public', 'assets', 'logo.png');
const LOGO_RATIO = 400 / 1428;
const NAVY = '#14284B';
const MUTED = '#64748B';
const LINE = '#E2E8F0';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', middot: '·', mdash: '—', ndash: '–', rsquo: '’', ldquo: '“', rdquo: '”' };
const decode = (s: string) => s.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m);
const plain = (html: string) => decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]*\n[ \t]*/g, ' ').replace(/\s+/g, ' ').trim();

// The document's headings, paragraphs and list items, in order.
function blocks(html: string) {
  const out: { kind: 'h' | 'p' | 'li'; text: string }[] = [];
  for (const m of html.matchAll(/<(h[1-3]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = plain(m[2]);
    if (text) out.push({ kind: m[1].toLowerCase().startsWith('h') ? 'h' : m[1].toLowerCase() === 'li' ? 'li' : 'p', text });
  }
  return out;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: serverEnv.timeZone, dateStyle: 'long', timeStyle: 'long' });

export async function signedAgreementPdf(restaurantId: number, approvedAt?: string | null): Promise<{ filename: string; pdf: Buffer }> {
  const db = supabaseAdmin();
  const r = must(await db.from('restaurants').select('id, name, address, city, zip, phone, owner_id, status').eq('id', restaurantId).single());
  const owner = must(await db.from('profiles').select('email, username').eq('id', r.owner_id).single());
  const { data: accepted } = await db.from('terms_acceptances').select('version, accepted_at, ip, user_agent')
    .eq('user_id', r.owner_id).eq('document', 'restaurant-agreement').order('accepted_at', { ascending: false }).limit(1).maybeSingle();
  const doc = renderDocument('restaurant-agreement', await company());
  if (!doc) throw new Error('Restaurant Partner Agreement not found.');
  const fingerprint = createHash('sha256').update(doc.html).digest('hex');

  const pdf = new PDFDocument({ size: 'LETTER', margins: { top: 64, bottom: 64, left: 64, right: 64 }, bufferPages: true,
    info: { Title: `${doc.title} - ${r.name}`, Author: serverEnv.legal.entity, Subject: 'Electronically signed agreement' } });
  pdf.registerFont('regular', path.join(FONT_DIR, 'inter-latin-400-normal.woff'));
  pdf.registerFont('bold', path.join(FONT_DIR, 'inter-latin-700-normal.woff'));
  pdf.registerFont('head', path.join(FONT_DIR, 'plus-jakarta-sans-latin-800-normal.woff'));
  pdf.registerFont('mono', path.join(FONT_DIR, 'IBMPlexMono-Regular.woff'));
  const L = pdf.page.margins.left;
  const W = pdf.page.width - L - pdf.page.margins.right;

  // Title block
  pdf.image(LOGO, L, 48, { width: 150 });
  pdf.font('head').fontSize(22).fillColor(NAVY).text(doc.title, L, 48 + 150 * LOGO_RATIO + 18, { width: W });
  pdf.font('regular').fontSize(10).fillColor(MUTED)
    .text(`Version ${doc.version} · Effective ${doc.effective} · Electronically signed copy`, { width: W });
  pdf.moveDown(0.8);
  pdf.font('bold').fontSize(10).fillColor('#111').text('Between ', { continued: true })
    .font('regular').text(`${serverEnv.legal.entity} (${serverEnv.legal.address}) and ${r.name}, ${r.address}, ${r.city}, WA ${r.zip}.`, { width: W });
  pdf.moveTo(L, pdf.y + 10).lineTo(L + W, pdf.y + 10).strokeColor(LINE).lineWidth(1).stroke();
  pdf.moveDown(1.4);

  // The agreement text
  for (const b of blocks(doc.html)) {
    if (b.kind === 'h') {
      pdf.moveDown(0.5).font('bold').fontSize(11.5).fillColor(NAVY).text(b.text, { width: W });
      pdf.moveDown(0.25);
    } else {
      pdf.font('regular').fontSize(9.5).fillColor('#1E293B').text(b.kind === 'li' ? `•  ${b.text}` : b.text, { width: W, lineGap: 2, indent: b.kind === 'li' ? 10 : 0 });
      pdf.moveDown(0.45);
    }
  }

  // Signature record
  pdf.addPage();
  pdf.font('head').fontSize(18).fillColor(NAVY).text('Electronic signature record', L, pdf.page.margins.top, { width: W });
  pdf.font('regular').fontSize(9.5).fillColor(MUTED).text(
    `This page records how the agreement above was signed. ${r.name}'s representative reviewed the full text in the Bite Wise sign-up form, ` +
    'checked "I have read and agree to the Restaurant Partner Agreement and Privacy Policy. I understand this is a legally binding agreement." ' +
    'and selected "Accept & create account". The account could not be created without that acceptance.', { width: W, lineGap: 2 });
  pdf.moveDown(1);

  const rows: [string, string][] = [
    ['Restaurant', `${r.name}\n${r.address}, ${r.city}, WA ${r.zip}${r.phone ? `\nTel ${displayPhone(r.phone)}` : ''}`],
    ['Signed by', `${owner.username} <${owner.email}>`],
    ['Signed on', accepted ? when(accepted.accepted_at) : 'No acceptance record found'],
    ['IP address', accepted?.ip || 'not recorded'],
    ['Device', accepted?.user_agent ? accepted.user_agent.slice(0, 180) : 'not recorded'],
    ['Document', `${doc.title}, version ${accepted?.version ?? doc.version}${accepted && accepted.version !== doc.version ? ` (this copy shows the current version, ${doc.version})` : ''}`],
    ['Fingerprint', `SHA-256 of the document text:\n${fingerprint}`],
    ['Accepted by', `${serverEnv.legal.entity}, on approval of the restaurant${approvedAt ? `: ${when(approvedAt)}` : r.status === 'approved' ? '' : ' (not yet approved)'}`],
  ];
  const labelW = 110;
  for (const [label, value] of rows) {
    const y = pdf.y;
    pdf.font('bold').fontSize(9.5).fillColor(NAVY).text(label, L, y, { width: labelW });
    pdf.font(label === 'Fingerprint' || label === 'IP address' ? 'mono' : 'regular').fontSize(9.5).fillColor('#111').text(value, L + labelW, y, { width: W - labelW, lineGap: 1.5 });
    pdf.moveTo(L, pdf.y + 6).lineTo(L + W, pdf.y + 6).strokeColor(LINE).lineWidth(0.8).stroke();
    pdf.y += 12;
  }
  pdf.moveDown(1);
  pdf.font('regular').fontSize(8.5).fillColor(MUTED).text(
    `Generated ${when(new Date().toISOString())}. Questions about this agreement: ${serverEnv.legal.email}.`, L, pdf.y, { width: W });

  // Page numbers
  const range = pdf.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(range.start + i);
    const bottom = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0;
    pdf.font('regular').fontSize(8).fillColor(MUTED)
      .text(`${doc.title} · ${r.name} · Page ${i + 1} of ${range.count}`, L, pdf.page.height - 40, { width: W, align: 'center' });
    pdf.page.margins.bottom = bottom;
  }

  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => { pdf.on('end', () => resolve(Buffer.concat(chunks))); pdf.on('error', reject); });
  pdf.end();
  const safe = r.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'restaurant';
  return { filename: `Bite-Wise-Partner-Agreement-${safe}.pdf`, pdf: await done };
}
