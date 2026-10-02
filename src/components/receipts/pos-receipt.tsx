import type { Receipt } from '@/lib/receipts/data';
import { money, pct } from '@/lib/format';

// Point-of-sale (80 mm thermal) receipt. The PDF version is drawn by src/lib/receipts/pdf.ts.
const Row = ({ left, right, className = '' }: { left: React.ReactNode; right?: React.ReactNode; className?: string }) => (
  <div className={`pos-row ${className}`}><span>{left}</span><span>{right}</span></div>
);

function Barcode({ bars }: { bars: number[] }) {
  const starts = bars.map((_, i) => bars.slice(0, i).reduce((a, b) => a + b, 0));
  const width = bars.reduce((a, b) => a + b, 0);
  return (
    <svg className="pos-barcode" viewBox={`0 0 ${width} 40`} preserveAspectRatio="none" role="img" aria-label="Barcode">
      {bars.map((w, i) => (i % 2 === 0 ? <rect key={i} x={starts[i]} width={w} height={40} /> : null))}
    </svg>
  );
}

export function PosReceipt({ r }: { r: Receipt }) {
  const it = r.item;
  const rest = r.restaurant;
  const paidWith = r.creditAppliedCents
    ? r.creditAppliedCents >= r.totalCents ? 'Platform credit' : `${r.card} + credit`
    : r.card || 'n/a';
  return (
    <div className="pos-shadow">
      <article className="pos" aria-label={`Receipt ${r.receiptNumber}`}>
        <header className="pos-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="pos-logo" src="/assets/logo.svg" alt="Bite Wise" />
          <div className="pos-tag">Rescued food · Greater Seattle</div>
          <div className="pos-store">{rest.name}</div>
          <div>{rest.address}<br />{rest.city}, WA {rest.zip}{rest.phone && <><br />Tel {rest.phone}</>}</div>
        </header>
        <hr className="pos-dash" />
        <Row left="Receipt" right={r.receiptNumber} />
        <Row left="Order #" right={r.orderId} />
        <Row left="Ordered" right={r.orderedAtText} />
        {r.status === 'picked_up' ? <Row left="Picked up" right={r.pickedUpAtText} /> : <Row left="Pick up by" right={r.pickupByText} />}
        <Row left="Customer" right={r.customer.username} />
        <Row left="Status" right={r.statusLabel} className="b" />
        <hr className="pos-dash" />
        <Row left={`${it.quantity} x ${it.title}`} right={money(it.lineTotalCents)} className="b item" />
        <Row left={<>@ {money(it.unitPriceCents)} ea&nbsp; (-{it.discountPct}%)</>} right={<s>{money(it.lineOriginalCents)}</s>} className="sub" />
        <div className="pos-note">Reg. {money(it.originalUnitCents)} ea, you save {money(it.savingsCents)}</div>
        <hr className="pos-dash" />
        <Row left="Menu value" right={money(it.lineOriginalCents)} />
        <Row left={`Discount ${it.discountPct}%`} right={`-${money(it.savingsCents)}`} />
        <Row left="Subtotal" right={money(r.subtotalCents)} />
        <Row left={`Service fee ${r.serviceFeePct}%`} right={money(r.serviceFeeCents)} />
        <Row left={`WA sales tax ${pct(r.taxRateBps)}`} right={money(r.taxCents)} />
        <hr className="pos-double" />
        <Row left="Total" right={money(r.totalCents)} className="total" />
        {r.creditAppliedCents > 0 && (
          <>
            <Row left="Platform credit" right={`-${money(r.creditAppliedCents)}`} />
            <Row left="Balance to card" right={money(r.totalCents - r.creditAppliedCents)} className="b" />
          </>
        )}
        <hr className="pos-dash" />
        <Row left="Paid with" right={paidWith} />
        <Row left="Charged" right={money(r.amountChargedCents)} className="b" />
        <div className="pos-note flush">Payment: {r.paymentStatus}</div>
        <div className="pos-note flush break">Txn ID: {r.paymentRef || 'n/a'}</div>
        {r.refunds.length > 0 && (
          <>
            <hr className="pos-dash" />
            <div className="pos-center b">*** Refunds ***</div>
            {r.refunds.map((f, i) => (
              <div key={i}>
                <Row left="Refund" right={`-${money(f.amountCents)}`} className="b" />
                <div className="pos-note">To {f.to}<br />{f.atText} · {f.reason}</div>
              </div>
            ))}
          </>
        )}
        <hr className="pos-dash" />
        <div className="pos-saved">You saved {money(it.savingsCents)} today!</div>
        <div className="pos-center small-print">{it.quantity === 1 ? '1 meal' : `${it.quantity} meals`} rescued from going to waste</div>
        {r.pin && (
          <>
            <hr className="pos-dash" />
            <div className="pos-center">
              <div className="b pos-spaced">PICKUP PIN</div>
              <div className="pos-pin">{r.pin}</div>
              <div className="small-print">Show this PIN at the counter</div>
            </div>
          </>
        )}
        <hr className="pos-dash" />
        <div className="pos-center">
          <Barcode bars={r.barcode} />
          <div className="pos-spaced small-print">{r.receiptNumber}</div>
          <div className="b pos-thanks">Thank you for rescuing food!</div>
          <p className="small-print">
            Your card is authorized when you order and charged only when the restaurant confirms pickup with your PIN. Orders not picked up are
            released without charge. Times in Pacific Time.
          </p>
          <div className="small-print">support@bitewise.app</div>
        </div>
      </article>
    </div>
  );
}
