import { useEffect, useMemo, useRef, useState } from 'react';
import { DAY_NAMES, HOUR_LABELS } from '../lib/format';

/**
 * Small hand-built SVG charts. Colours are validated for colour-blind
 * separation and contrast on the dark chart surface:
 *   purple #8b5cf6 · teal #0d9488 · heatmap ramp #5229b8 → #cbb8ff
 */
export const CHART = { purple: '#8b5cf6', teal: '#0d9488' };
const HEAT = ['#5229b8', '#6d3fe0', '#8b5cf6', '#a98bff', '#cbb8ff'];

interface Tip {
  x: number;
  y: number;
  title: string;
  value: string;
}

/** Width of an element, kept up to date as it resizes. */
function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function compact(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}K`;
  if (v < 10 && v % 1) return v.toFixed(1);
  return String(Math.round(v));
}

/** Single-series column chart with a hover tooltip. */
export function ColumnChart({
  data,
  color = CHART.purple,
  height = 180,
  format = (v: number) => compact(v),
  tickEvery = 1,
  label,
}: {
  data: { label: string; tip?: string; value: number }[];
  color?: string;
  height?: number;
  format?: (v: number) => string;
  tickEvery?: number;
  label: string;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Thin out the axis labels on narrow screens.
  const every = Math.max(tickEvery, Math.ceil((data.length * 34) / Math.max(1, W - 40)));
  const pad = { l: 34, r: 6, t: 10, b: 22 };
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const innerW = W - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const band = innerW / Math.max(1, data.length);
  const barW = Math.min(24, Math.max(3, band - 2));
  const ticks = [0, max / 2, max];
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;

  const show = (i: number, e: React.MouseEvent | React.FocusEvent) => {
    const box = ref.current?.getBoundingClientRect();
    const target = (e.currentTarget as Element).getBoundingClientRect();
    if (!box) return;
    setHover(i);
    setTip({ x: target.left - box.left + target.width / 2, y: target.top - box.top, title: data[i].tip ?? data[i].label, value: format(data[i].value) });
  };

  return (
    <div className="chart" ref={ref} onMouseLeave={() => (setTip(null), setHover(null))}>
      <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="tick">
              {compact(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = Math.max(0, innerH - (y(d.value) - pad.t));
          const x = pad.l + i * band + (band - barW) / 2;
          const r = Math.min(4, h / 2, barW / 2);
          const top = pad.t + innerH - h;
          return (
            <g key={i}>
              {h > 0 && (
                <path
                  d={`M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`}
                  fill={color}
                  opacity={hover == null || hover === i ? 1 : 0.45}
                />
              )}
              <rect
                x={pad.l + i * band}
                y={pad.t}
                width={band}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                onMouseEnter={(e) => show(i, e)}
                onFocus={(e) => show(i, e)}
                onBlur={() => (setTip(null), setHover(null))}
                aria-label={`${d.tip ?? d.label}: ${format(d.value)}`}
              />
              {i % every === 0 && (
                <text x={pad.l + i * band + band / 2} y={height - 6} textAnchor="middle" className="tick">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
          <div className="faint">{tip.title}</div>
          <div style={{ fontWeight: 600 }}>{tip.value}</div>
        </div>
      )}
    </div>
  );
}

/** Day-of-week × hour-of-day grid of watch time. */
export function WeekHeatmap({ week, label }: { week: number[][]; label: string }) {
  const [tip, setTip] = useState<{ d: number; h: number } | null>(null);
  const max = useMemo(() => Math.max(0, ...week.flat()), [week]);
  const cell = (v: number) => {
    if (!v || !max) return 'var(--surface-2)';
    const i = Math.min(HEAT.length - 1, Math.floor((v / max) * HEAT.length));
    return HEAT[i];
  };
  // Monday first reads more naturally for viewing habits.
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="heat" role="img" aria-label={label}>
      <div className="heat-grid">
        <div />
        {HOUR_LABELS.map((h, i) => (
          <div key={h} className="heat-hour">
            {i % 3 === 0 ? h : ''}
          </div>
        ))}
        {order.map((d) => (
          <div key={d} style={{ display: 'contents' }}>
            <div className="heat-day">{DAY_NAMES[d]}</div>
            {week[d].map((v, h) => (
              <div
                key={h}
                className="heat-cell"
                style={{ background: cell(v) }}
                onMouseEnter={() => setTip({ d, h })}
                onMouseLeave={() => setTip(null)}
                title={`${DAY_NAMES[d]} ${HOUR_LABELS[h]}: ${v ? `${(v * 60).toFixed(0)} min` : 'nothing'}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="row small faint" style={{ marginTop: 10, gap: 6, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span>{tip ? `${DAY_NAMES[tip.d]} ${HOUR_LABELS[tip.h]} — ${week[tip.d][tip.h] ? `${Math.round(week[tip.d][tip.h] * 60)} min watched` : 'nothing watched'}` : 'Hover a square for details'}</span>
        <span className="row" style={{ gap: 4 }}>
          Less
          {['var(--surface-2)', ...HEAT].map((c) => (
            <span key={c} className="heat-key" style={{ background: c }} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

/** Ranked horizontal bars (a list with proportional bars). */
export function RankBars({ rows, color = CHART.teal, format }: { rows: { key: string; label: React.ReactNode; value: number; extra?: React.ReactNode }[]; color?: string; format: (v: number) => string }) {
  const max = Math.max(0, ...rows.map((r) => r.value)) || 1;
  return (
    <div className="rank">
      {rows.map((r) => (
        <div key={r.key} className="rank-row">
          <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
            <div className="small muted" style={{ whiteSpace: 'nowrap' }}>
              {format(r.value)} {r.extra}
            </div>
          </div>
          <div className="rank-track">
            <span style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
