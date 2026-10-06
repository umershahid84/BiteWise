// Owner console downloads (src/lib/exports.ts): every tab's report, one table of it, as CSV and PDF.
import { describe, expect, it } from 'vitest';
import { cellText, report, reportCsv } from '@/lib/exports';
import { listReportPdf } from '@/lib/receipts/pdf';
import { supabaseAvailable } from '../support/db';

const available = await supabaseAvailable();
const params = (o: Record<string, string> = {}) => new URLSearchParams(o);

describe.skipIf(!available)('owner console downloads', () => {
  it.each(['restaurants', 'users', 'orders', 'payouts', 'tax', 'audit'])('%s: CSV and PDF', async (kind) => {
    const { report: r, whole } = await report(kind, params());
    expect(whole).toBe(true);
    const csv = reportCsv(r);
    expect(csv.split('\n')[0]).toContain(r.title);
    for (const t of r.tables) {
      expect(csv).toContain(t.columns.map((c) => c.h).join(','));
      for (const row of t.rows) expect(row).toHaveLength(t.columns.length);
      if (t.total) expect(t.total).toHaveLength(t.columns.length);
    }
    const pdf = await listReportPdf(r, { generatedAt: 'now', text: (c) => cellText(c, false) });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('downloads one table of a tab, and refuses an unknown one', async () => {
    const { report: r, whole } = await report('payouts', params({ section: 'history' }));
    expect(whole).toBe(false);
    expect(r.tables.map((t) => t.id)).toEqual(['history']);
    expect(r.file).toBe('payouts-history');
    expect(r.figures).toBeUndefined();
    await expect(report('payouts', params({ section: 'nope' }))).rejects.toThrow(/Not found/);
    await expect(report('nope', params())).rejects.toThrow(/Not found/);
  });

  it('keeps the tab filters: orders by status', async () => {
    const { report: r } = await report('orders', params({ status: 'picked_up' }));
    const status = r.tables[0].columns.findIndex((c) => c.h === 'Status');
    expect(r.tables[0].rows.every((row) => row[status] === 'Picked up')).toBe(true);
    expect(r.subtitle).toContain('Status: Picked up');
  });

  it('writes money as plain numbers in a CSV and with $ in a PDF', () => {
    expect(cellText({ cents: 123456 }, true)).toBe('1234.56');
    expect(cellText({ cents: 123456 }, false)).toBe('$1,234.56');
  });
});
