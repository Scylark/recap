import { useMemo, useRef, useState } from 'react';

export interface Series {
  name: string;
  values: number[];
}

/** Series colours: the first slot always goes to the biggest series, "Other" is always grey. */
export function seriesColor(i: number, name: string): string {
  return name === 'Other' ? 'var(--series-other)' : `var(--series-${(i % 6) + 1})`;
}

const W = 760;
const H = 260;
const PAD = { top: 12, right: 16, bottom: 28, left: 44 };

function niceMax(v: number): number {
  if (v <= 4) return Math.max(1, Math.ceil(v));
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/**
 * A plain SVG line chart with a hover crosshair and tooltip. One y axis, recessive grid,
 * 2px lines, and a legend whenever there is more than one series.
 */
export function LineChart({
  labels,
  series,
  format = (n) => n.toLocaleString(),
}: {
  labels: string[];
  series: Series[];
  format?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const max = useMemo(() => niceMax(Math.max(0, ...series.flatMap((s) => s.values))), [series]);
  const n = labels.length;
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  // Whole-number ticks when the counts are whole numbers.
  const parts = [4, 5, 2, 1].find((d) => Number.isInteger(max / d)) ?? 4;
  const ticks = Array.from({ length: parts + 1 }, (_, i) => (i / parts) * max);
  const every = Math.max(1, Math.ceil(n / 8));

  const onMove = (e: React.PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || n === 0) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = n <= 1 ? 0 : Math.round(((px - PAD.left) / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="chart">
      {series.length > 1 && (
        <div className="legend">
          {series.map((s, i) => (
            <span key={s.name}>
              <i style={{ background: seriesColor(i, s.name) }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <div className="chart-plot">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Line chart"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
              <text x={PAD.left - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">
                {format(Math.round(t * 100) / 100)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % every === 0 || i === n - 1 ? (
              <text key={i} x={x(i)} y={H - 8} className="axis" textAnchor="middle">
                {l}
              </text>
            ) : null,
          )}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} className="crosshair" />}
          {series.map((s, si) => (
            <g key={s.name} style={{ color: seriesColor(si, s.name) }}>
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              />
              {(n <= 1 || hover != null) &&
                s.values.map((v, i) =>
                  n <= 1 || i === hover ? (
                    <circle key={i} cx={x(i)} cy={y(v)} r={4} fill="currentColor" stroke="var(--panel)" strokeWidth={2} />
                  ) : null,
                )}
            </g>
          ))}
        </svg>
        {hover != null && (
          <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <strong>{labels[hover]}</strong>
            {series.map((s, i) => (
              <div key={s.name} className="tooltip-row">
                <i style={{ background: seriesColor(i, s.name) }} />
                <span>{s.name}</span>
                <b>{format(s.values[hover] ?? 0)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
