'use client';

import { useState } from 'react';
import { money } from './shared';

type Day = { date: string; orders: number; meals: number; gmvCents: number; feesCents: number; foodCents: number };

// Single-series bar chart of total charged per day, with a per-bar hover tooltip. One validated
// hue (#0fa874 on the dark surface), 4px rounded bar tops anchored to the baseline, recessive grid.
export function DailyChart({ rows }: { rows: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 900;
  const H = 240;
  const m = { t: 12, r: 12, b: 28, l: 56 };
  const max = Math.max(100, ...rows.map((r) => r.gmvCents));
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * pow).find((s) => s >= rough) ?? rough;
  const top = Math.ceil(max / step) * step;
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const bw = iw / Math.max(1, rows.length);
  const barW = Math.max(2, Math.min(28, bw - 2));
  const y = (v: number) => m.t + ih - (v / top) * ih;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const labelEvery = Math.ceil(rows.length / 10);
  const h = hover !== null ? rows[hover] : null;
  return (
    <div className="relative">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily total charged, bar chart" onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={m.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)">{money(v).replace('.00', '')}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = m.l + i * bw + (bw - barW) / 2;
          const hh = Math.max(r.gmvCents ? 2 : 0, (r.gmvCents / top) * ih);
          const rad = Math.min(4, barW / 2, hh);
          return (
            <g key={r.date} onMouseEnter={() => setHover(i)}>
              <rect x={m.l + i * bw} y={m.t} width={bw} height={ih} fill="transparent" />
              {hh > 0 && (
                <path
                  d={`M${x},${m.t + ih} v${-(hh - rad)} q0,${-rad} ${rad},${-rad} h${barW - 2 * rad} q${rad},0 ${rad},${rad} v${hh - rad} z`}
                  fill="#0fa874"
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              {i % labelEvery === 0 && (
                <text x={m.l + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-muted)">
                  {new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                </text>
              )}
            </g>
          );
        })}
        <line x1={m.l} x2={W - m.r} y1={m.t + ih} y2={m.t + ih} stroke="var(--color-muted)" strokeWidth={1} />
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-bg-2 px-3 py-2 text-xs shadow-pop"
          style={{ left: `${Math.min(80, ((m.l + hover * bw) / W) * 100)}%` }}
        >
          <b className="text-ink">{new Date(`${h.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</b>
          <div className="text-ink-2">Total charged <b className="text-ink">{money(h.gmvCents)}</b></div>
          <div className="text-ink-2">Orders {h.orders} · Meals {h.meals}</div>
          <div className="text-ink-2">Service fees {money(h.feesCents)}</div>
        </div>
      )}
    </div>
  );
}
