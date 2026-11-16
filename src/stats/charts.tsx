/* Hand-rolled SVG charts, drawn in pixel space (measured width) so labels keep a real font size. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { niceTicks, parseDayKey, type DayBar, type WpmPoint } from './aggregate';

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const fmtDay = (key: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  parseDayKey(key).toLocaleDateString(undefined, opts);

export const formatMinutes = (m: number) => {
  if (m <= 0) return '0 min';
  if (m < 1) return '<1 min';
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r ? `${h} h ${r} min` : `${h} h`;
};

// ---------------------------------------------------------------------------
// Progress ring
// ---------------------------------------------------------------------------

export function ProgressRing({ value, max, size = 132, stroke = 12, children }: { value: number; max: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, value / max) : value > 0 ? 1 : 0;
  return (
    <div className="tm-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        {frac > 0 ? (
          <circle
            className="tm-ring__value"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * frac} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </svg>
      <div className="tm-ring__label">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tw, setTw] = useState(120);
  useEffect(() => {
    if (ref.current) setTw(ref.current.offsetWidth);
  });
  const left = Math.max(0, Math.min(width - tw, x - tw / 2));
  return (
    <div ref={ref} className="tm-chart-tip" style={{ left, top: Math.max(0, y - 52) }} aria-hidden="true">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minutes per day (bars)
// ---------------------------------------------------------------------------

export function MinutesChart({ bars, goalMinutes, title }: { bars: DayBar[]; goalMinutes: number; title: string }) {
  const [ref, width] = useWidth<HTMLElement>();
  const [hover, setHover] = useState<number | null>(null);
  const descId = useId();
  const height = 200;
  const m = { top: 26, right: 8, bottom: 28, left: 40 };
  const maxVal = Math.max(goalMinutes, ...bars.map((b) => b.minutes), 5);
  const { ticks, max } = niceTicks(0, maxVal, 4);
  const iw = Math.max(0, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const step = bars.length ? iw / bars.length : 0;
  const bw = Math.max(2, step - Math.min(4, step * 0.3));
  const y = (v: number) => m.top + ih - (v / max) * ih;
  const total = bars.reduce((a, b) => a + b.minutes, 0);
  const active = bars.filter((b) => b.minutes > 0).length;
  const summary = `Minutes read per day over the last ${bars.length} days. ${formatMinutes(total)} in total on ${active} ${active === 1 ? 'day' : 'days'}${goalMinutes ? `; daily goal ${goalMinutes} min` : ''}.`;

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - m.left) / (step || 1));
    setHover(i >= 0 && i < bars.length ? i : null);
  };

  // label roughly every week, always the last day ("Today")
  const labelEvery = width < 420 ? 7 : width < 700 ? 5 : 3;
  const h = hover != null ? bars[hover] : null;

  return (
    <figure className="tm-chart" ref={ref}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={title} aria-describedby={descId} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className="tm-chart__grid" />
              <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tm-chart__tick">
                {t}
              </text>
            </g>
          ))}
          <text x={4} y={10} className="tm-chart__axis-title">
            min
          </text>
          {bars.map((b, i) => {
            const x = m.left + i * step + (step - bw) / 2;
            const isToday = i === bars.length - 1;
            const bh = b.minutes > 0 ? Math.max(2, (b.minutes / max) * ih) : 0;
            return (
              <g key={b.day}>
                {bh > 0 ? (
                  <rect
                    x={x}
                    y={m.top + ih - bh}
                    width={bw}
                    height={bh}
                    rx={Math.min(4, bw / 2)}
                    className={`tm-chart__bar${isToday ? ' is-today' : ''}${goalMinutes && b.minutes >= goalMinutes ? ' is-goal' : ''}${hover === i ? ' is-hover' : ''}`}
                  />
                ) : (
                  <rect x={x} y={m.top + ih - 1} width={bw} height={1} className="tm-chart__bar-empty" />
                )}
                {(bars.length - 1 - i) % labelEvery === 0 ? (
                  <text x={x + bw / 2} y={height - 8} textAnchor="middle" className={`tm-chart__tick${isToday ? ' is-strong' : ''}`}>
                    {isToday ? 'Today' : fmtDay(b.day, { day: 'numeric', month: 'numeric' })}
                  </text>
                ) : null}
              </g>
            );
          })}
          {goalMinutes > 0 ? (
            <g>
              <line x1={m.left} x2={width - m.right} y1={y(goalMinutes)} y2={y(goalMinutes)} className="tm-chart__goal" />
              <text x={width - m.right} y={y(goalMinutes) - 5} textAnchor="end" className="tm-chart__goal-label">
                goal {goalMinutes} min
              </text>
            </g>
          ) : null}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {h && hover != null ? (
        <Tooltip x={m.left + hover * step + step / 2} y={y(h.minutes)} width={width}>
          <strong>{formatMinutes(h.minutes)}</strong>
          <span>{hover === bars.length - 1 ? 'Today' : fmtDay(h.day, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        </Tooltip>
      ) : null}
      <div className="chart-legend" aria-hidden="true">
        {goalMinutes > 0 ? (
          <>
            <span><i className="chart-legend__sw is-goal" />Goal met</span>
            <span><i className="chart-legend__sw" />Under goal</span>
          </>
        ) : (
          <span><i className="chart-legend__sw" />Minutes read</span>
        )}
        <span><i className="chart-legend__sw is-today" />Today</span>
      </div>
      <figcaption id={descId} className="visually-hidden">
        {summary}
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Average WPM over time (line)
// ---------------------------------------------------------------------------

export function WpmChart({
  points,
  bucket,
  trend,
  title,
}: {
  points: WpmPoint[];
  bucket: 'day' | 'week';
  trend: { start: number; end: number } | null;
  title: string;
}) {
  const [ref, width] = useWidth<HTMLElement>();
  const [hover, setHover] = useState<number | null>(null);
  const descId = useId();
  const height = 220;
  const m = { top: 26, right: 14, bottom: 28, left: 44 };
  const vals = points.map((p) => p.wpm);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  // Not zero-based on purpose (speed changes are small relative to the total), but always padded and
  // labelled so the scale is explicit; the caption states the actual numbers.
  const pad = Math.max(20, (hi - lo) * 0.15);
  const { ticks, min, max } = niceTicks(Math.max(0, lo - pad), hi + pad, 4);
  const iw = Math.max(0, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  // x by real time (gaps between reading days stay visible), via index of day difference
  const t0 = parseDayKey(points[0].day).getTime();
  const t1 = parseDayKey(points[points.length - 1].day).getTime();
  const span = Math.max(1, t1 - t0);
  const x = (day: string) => m.left + ((parseDayKey(day).getTime() - t0) / span) * iw;
  const y = (v: number) => m.top + ih - ((v - min) / (max - min || 1)) * ih;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.wpm).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points[points.length - 1].day).toFixed(1)},${m.top + ih} L${m.left},${m.top + ih} Z`;
  const gradId = useId().replace(/:/g, '');

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bd = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(x(p.day) - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  };

  const fmtX = (day: string) => (bucket === 'week' ? `wk of ${fmtDay(day)}` : fmtDay(day));
  // x labels: first, last and up to 2 in between when there is room
  const labelIdx = new Set<number>([0, points.length - 1]);
  if (width > 480 && points.length > 4) {
    labelIdx.add(Math.round((points.length - 1) / 3));
    labelIdx.add(Math.round(((points.length - 1) * 2) / 3));
  }
  const h = hover != null ? points[hover] : null;
  const showDots = iw / points.length > 6;

  return (
    <figure className="tm-chart" ref={ref}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={title} aria-describedby={descId} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className="tm-chart__grid" />
              <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tm-chart__tick">
                {t}
              </text>
            </g>
          ))}
          <text x={4} y={10} className="tm-chart__axis-title">
            wpm
          </text>
          <path d={area} fill={`url(#${gradId})`} />
          {trend ? (
            <line
              x1={x(points[0].day)}
              x2={x(points[points.length - 1].day)}
              y1={y(trend.start)}
              y2={y(trend.end)}
              className="tm-chart__trend"
            />
          ) : null}
          <path d={path} className="tm-chart__line" />
          {points.map((p, i) =>
            showDots || hover === i ? (
              <circle key={p.day} cx={x(p.day)} cy={y(p.wpm)} r={hover === i ? 5.5 : 3.5} className={`tm-chart__dot${hover === i ? ' is-hover' : ''}`} />
            ) : null,
          )}
          {h ? <line x1={x(h.day)} x2={x(h.day)} y1={m.top} y2={m.top + ih} className="tm-chart__cross" /> : null}
          {[...labelIdx].map((i) => (
            <text
              key={i}
              x={x(points[i].day)}
              y={height - 8}
              textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
              className="tm-chart__tick"
            >
              {fmtX(points[i].day)}
            </text>
          ))}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {h ? (
        <Tooltip x={x(h.day)} y={y(h.wpm)} width={width}>
          <strong>{Math.round(h.wpm)} wpm</strong>
          <span>
            {fmtX(h.day)} · {formatMinutes(h.minutes)}
          </span>
        </Tooltip>
      ) : null}
      <figcaption id={descId} className="visually-hidden">
        {`Average reading speed per ${bucket}, ${points.length} points, from ${Math.round(points[0].wpm)} wpm on ${fmtX(points[0].day)} to ${Math.round(points[points.length - 1].wpm)} wpm on ${fmtX(points[points.length - 1].day)}. Lowest ${Math.round(lo)}, highest ${Math.round(hi)}.`}
      </figcaption>
    </figure>
  );
}
