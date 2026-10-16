/**
 * PERFORMANCE TRENDS, with depth (owner 2026-10-16: "can you make these graphs better to show more depth to them").
 *
 * The old panel drew four thin lines, and three of them were CUMULATIVE means that flattened into straight lines.
 * Here (dataviz method: form first, one axis per chart, thin marks, recessive grid, hover by default):
 *   - MMR, the one big chart: the rating after each rated run on a division-snapped axis, the MEDAL bands drawn as
 *     faint horizontal bands named at the right edge (the Battlegrounds rating-floor read), a soft gold area under
 *     the line with a static glow stroke, the peak marked, a filled dot on the latest point, three date ticks, and a
 *     crosshair + tooltip per run (date, placement, MMR change, hero) in the game's tip style.
 *   - Placement: EVERY game as a dot (1st a gold diamond, top 4 a green dot, 5th-8th a red ring: colour AND shape,
 *     so colour-blind players read it), 1st at the top, with the rolling average of the last 10 as the line.
 *   - Top 4 rate: the rolling share of the last 10 placed games, with a faint 50% reference line.
 *   - APM: each game a faint dot, the rolling average of the last 10 as the line.
 * Each small chart carries its window figure and the change against the previous period of the same length.
 *
 * Everything is static SVG drawn from the data; a window change just redraws. The crosshair reads the chart's rect
 * ONCE when the pointer enters (no per-frame layout reads) and moves with a transform. Season starts are not marked:
 * a run row carries no season id, so a reset cannot be told from a bad streak without guessing.
 */
import { useMemo, useRef, useState } from 'react';
import { getHero } from '@game/sim';
import { apmOf, isMatchWin, ordinalOf, playedOnText, type CareerRun, type TrendWindow } from './careerData';
import { medalOf, POINTS_PER_DIVISION } from './rank/types';

const ROLL = 10;
const DAY = 86_400_000;

interface RunPoint { atMs: number; place: number | null; mmr: number | null; delta: number | null; heroId: string; apm: number | null }

/** Runs inside the window (oldest first), plus the previous window of the same length for the deltas. Pure. */
export function trendRuns(runs: readonly CareerRun[], window_: TrendWindow, nowMs: number): { cur: RunPoint[]; prev: RunPoint[] | null } {
  const toPoint = (r: CareerRun): RunPoint => ({
    atMs: r.atMs, place: r.placement, mmr: r.ratingAfter === null ? null : Math.round(r.ratingAfter), delta: r.ratingDelta, heroId: r.heroId, apm: apmOf(r),
  });
  const dated = runs.filter((r) => Number.isFinite(r.atMs) && r.atMs <= nowMs + 60_000).slice().sort((a, b) => a.atMs - b.atMs);
  if (window_ === 'all') return { cur: dated.map(toPoint), prev: null };
  const since = nowMs - window_ * DAY;
  return {
    cur: dated.filter((r) => r.atMs >= since).map(toPoint),
    prev: dated.filter((r) => r.atMs >= since - window_ * DAY && r.atMs < since).map(toPoint),
  };
}

/** Trailing mean of the last `n` values at each index (the values that exist so far). Pure. */
export function rolling(values: readonly number[], n = ROLL): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= n) sum -= values[i - n]!;
    out.push(sum / Math.min(n, i + 1));
  }
  return out;
}

const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** The window figures and their change against the previous period (null when either side has no data). */
export function trendFigures(cur: readonly RunPoint[], prev: readonly RunPoint[] | null): {
  place: number | null; placeD: number | null; top4: number | null; top4D: number | null; apm: number | null; apmD: number | null;
} {
  const fig = (pts: readonly RunPoint[]) => {
    const places = pts.map((p) => p.place).filter((p): p is number => p !== null);
    const wins = places.map((p) => (isMatchWin(p) ? 100 : 0));
    const apms = pts.map((p) => p.apm).filter((a): a is number => a !== null);
    return { place: mean(places), top4: mean(wins), apm: mean(apms) };
  };
  const c = fig(cur);
  const p = prev ? fig(prev) : null;
  const d = (a: number | null, b: number | null | undefined): number | null => (a === null || b === null || b === undefined ? null : a - b);
  return { place: c.place, placeD: d(c.place, p?.place), top4: c.top4, top4D: d(c.top4, p?.top4), apm: c.apm, apmD: d(c.apm, p?.apm) };
}

function Delta({ v, better, unit = '', digits = 1 }: { v: number | null; better: 'up' | 'down'; unit?: string; digits?: number }) {
  if (v === null || Math.abs(v) < 10 ** -digits / 2) return null;
  const good = better === 'up' ? v > 0 : v < 0;
  return <span className={`ct-delta ${good ? 'good' : 'bad'}`}>{v > 0 ? '▲' : '▼'} {Math.abs(v).toFixed(digits)}{unit}</span>;
}

// ── The MMR chart ──────────────────────────────────────────────────────────────────────────────────────────────

const MW = 284, MH = 176, ML = 6, MR = 70, MT = 16, MB = 22;

function MmrChart({ pts, live, nowMs }: { pts: readonly RunPoint[]; live: number | null; nowMs: number }) {
  // The line ENDS on the live rating the crest prints (owner 2026-10-03): a closing "now" point when the last stamped
  // run disagrees. It is not a run, and its tooltip says so.
  const rated = useMemo(() => {
    const r = pts.filter((p) => p.mmr !== null) as Array<RunPoint & { mmr: number; now?: true }>;
    const lastPt = r[r.length - 1];
    if (live !== null && lastPt && lastPt.mmr !== live) r.push({ atMs: Math.max(nowMs, lastPt.atMs), place: null, mmr: live, delta: null, heroId: '', apm: null, now: true });
    return r;
  }, [pts, live, nowMs]);
  const geo = useMemo(() => {
    const ys = rated.map((p) => p.mmr);
    if (ys.length === 0) return null;
    const lo = Math.max(0, Math.floor((Math.min(...ys) - 1) / POINTS_PER_DIVISION) * POINTS_PER_DIVISION);
    const hi = Math.max(lo + POINTS_PER_DIVISION, Math.ceil((Math.max(...ys) + 1) / POINTS_PER_DIVISION) * POINTS_PER_DIVISION);
    const iw = MW - ML - MR, ih = MH - MT - MB;
    const yOf = (v: number): number => MT + (1 - (v - lo) / (hi - lo)) * ih;
    const n = rated.length;
    const xOf = (i: number): number => (n <= 1 ? ML + iw / 2 : ML + (i / (n - 1)) * iw);
    const xy = rated.map((p, i) => ({ x: xOf(i), y: yOf(p.mmr), p }));
    // Medal bands: one per medal the axis crosses, named at the right edge.
    const bands: Array<{ y0: number; y1: number; name: string; k: number }> = [];
    let k = 0;
    for (let v = lo; v < hi; v += POINTS_PER_DIVISION) {
      const name = medalOf(Math.floor(v / POINTS_PER_DIVISION));
      const last = bands[bands.length - 1];
      if (last && last.name === name) last.y0 = yOf(v + POINTS_PER_DIVISION);
      else bands.push({ y0: yOf(v + POINTS_PER_DIVISION), y1: yOf(v), name, k: k++ });
    }
    const ticks: number[] = [];
    for (let v = lo; v <= hi; v += POINTS_PER_DIVISION) ticks.push(v);
    const step = Math.ceil(ticks.length / 5);
    let peak = xy[0];
    for (const q of xy) if (peak && q.p.mmr > peak.p.mmr) peak = q;
    return { lo, hi, xy, bands, ticks: ticks.filter((_, i) => i % step === 0 || i === ticks.length - 1), yOf, peak, ih };
  }, [rated, live]);

  const wrap = useRef<HTMLDivElement>(null);
  const rect = useRef<{ left: number; width: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (!geo || geo.xy.length === 0) return <div className="ct-empty">No rated runs in this window</div>;
  const line = geo.xy.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
  const area = `${geo.xy[0]!.x.toFixed(1)},${(MH - MB).toFixed(1)} ${line} ${geo.xy[geo.xy.length - 1]!.x.toFixed(1)},${(MH - MB).toFixed(1)}`;
  const last = geo.xy[geo.xy.length - 1]!;
  const dates = geo.xy.length > 2 ? [geo.xy[0]!, geo.xy[Math.floor(geo.xy.length / 2)]!, last] : [geo.xy[0]!, last];
  const h = hover === null ? null : geo.xy[hover] ?? null;
  const onMove = (e: React.PointerEvent): void => {
    if (!rect.current && wrap.current) { const r = wrap.current.getBoundingClientRect(); rect.current = { left: r.left, width: r.width }; }
    const r = rect.current; if (!r) return;
    const x = ((e.clientX - r.left) / r.width) * MW;
    let best = 0;
    for (let i = 1; i < geo.xy.length; i++) if (Math.abs(geo.xy[i]!.x - x) < Math.abs(geo.xy[best]!.x - x)) best = i;
    if (best !== hover) setHover(best);
  };
  return (
    <div className="ct-mmr" ref={wrap} onPointerEnter={() => { rect.current = null; }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${MW} ${MH}`} role="img" aria-label={`MMR after each rated run, latest ${last.p.mmr}`}>
        <defs>
          <linearGradient id="ct-mmr-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#e8c877" stopOpacity="0.32" />
            <stop offset="1" stopColor="#e8c877" stopOpacity="0" />
          </linearGradient>
        </defs>
        {geo.bands.map((b) => (
          <g key={b.name}>
            <rect className={`ct-band${b.k % 2 ? ' alt' : ''}`} x={ML} y={b.y0} width={MW - ML - MR} height={Math.max(0, b.y1 - b.y0)} />
            {b.y1 - b.y0 >= 11 && <text className="ct-band-l" x={MW - MR + 6} y={(b.y0 + b.y1) / 2 + 4}>{b.name}</text>}
          </g>
        ))}
        {geo.ticks.map((t) => <line key={t} className="ct-grid" x1={ML} x2={MW - MR} y1={geo.yOf(t)} y2={geo.yOf(t)} />)}
        {geo.xy.length > 1 && <polygon className="ct-area" points={area} fill="url(#ct-mmr-fill)" />}
        {geo.xy.length > 1 && <polyline className="ct-glow" points={line} />}
        {geo.xy.length > 1 && <polyline className="ct-line" points={line} />}
        {geo.peak && geo.xy.length > 1 && (
          <g className="ct-peak">
            <circle cx={geo.peak.x} cy={geo.peak.y} r="3.5" />
            <text x={Math.min(geo.peak.x, MW - MR - 50)} y={Math.max(11, geo.peak.y - 7)}>Peak {geo.peak.p.mmr}</text>
          </g>
        )}
        <circle className="ct-last" cx={last.x} cy={last.y} r="4.5" />
        {h && <line className="ct-cross" x1={h.x} x2={h.x} y1={MT} y2={MH - MB} />}
        {h && <circle className="ct-hot" cx={h.x} cy={h.y} r="5" />}
        {dates.map((q, i) => (
          <text key={i} className="ct-date" x={q.x} y={MH - 6} textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}>{playedOnText(q.p.atMs).replace(/, \d{4}$/, '')}</text>
        ))}
      </svg>
      {h && (
        <div className="atip ct-pos" style={{ left: `${(h.x / MW) * 100}%`, top: `${(h.y / MH) * 100}%` }} role="tooltip">
          <b>{h.p.mmr} MMR</b>
          {h.p.delta !== null && h.p.delta !== 0 && <span className={h.p.delta > 0 ? 'good' : 'bad'}>{h.p.delta > 0 ? `+${h.p.delta}` : h.p.delta}</span>}
          <span>{'now' in h.p && h.p.now ? 'Your rating now' : `${h.p.place !== null ? ordinalOf(h.p.place) : 'No placement'}${h.p.heroId ? `, ${getHero(h.p.heroId).name}` : ''}`}</span>
          <span className="dim">{playedOnText(h.p.atMs)}</span>
        </div>
      )}
    </div>
  );
}

// ── The small multiples ────────────────────────────────────────────────────────────────────────────────────────

const SW = 134, SH = 78, SP = 6;

function Small({ name, value, delta, children }: { name: string; value: string; delta: JSX.Element | null; children: React.ReactNode }) {
  return (
    <div className="ct-small">
      <div className="ct-small-head"><span className="ct-small-t">{name}</span><span className="ct-small-v">{value}</span></div>
      <svg viewBox={`0 0 ${SW} ${SH}`} aria-hidden="true">{children}</svg>
      <div className="ct-small-d">{delta}</div>
    </div>
  );
}

const sx = (i: number, n: number): number => (n <= 1 ? SW / 2 : SP + (i / (n - 1)) * (SW - 2 * SP));
const syOf = (lo: number, hi: number, invert = false) => (v: number): number => {
  const t = (v - lo) / Math.max(1e-9, hi - lo);
  return SP + (invert ? t : 1 - t) * (SH - 2 * SP);
};
const poly = (ys: readonly number[], y: (v: number) => number): string => ys.map((v, i) => `${sx(i, ys.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

export function TrendsBody({ runs, window_, nowMs, live }: { runs: readonly CareerRun[]; window_: TrendWindow; nowMs: number; live: number | null }) {
  const { cur, prev } = useMemo(() => trendRuns(runs, window_, nowMs), [runs, window_, nowMs]);
  const f = useMemo(() => trendFigures(cur, prev), [cur, prev]);
  const placed = cur.filter((p) => p.place !== null) as Array<RunPoint & { place: number }>;
  const places = placed.map((p) => p.place);
  const top4 = rolling(places.map((p) => (isMatchWin(p) ? 100 : 0)));
  const apms = cur.map((p) => p.apm).filter((a): a is number => a !== null);
  const apmHi = Math.max(10, Math.ceil(Math.max(0, ...apms) / 10) * 10);
  const py = syOf(1, 8, true);
  const ty = syOf(0, 100);
  const ay = syOf(0, apmHi);
  return (
    <>
      <div className="ct-mmr-head"><span className="cv2-trend-title">MMR</span><span className="cv2-trend-avg">{live ?? (cur.filter((p) => p.mmr !== null).pop()?.mmr ?? '-')}</span></div>
      <MmrChart pts={cur} live={live} nowMs={nowMs} />
      <div className="ct-grid2">
        <Small name="Placement" value={f.place === null ? '-' : f.place.toFixed(1)} delta={<Delta v={f.placeD} better="down" />}>
          <line className="ct-ref" x1={SP} x2={SW - SP} y1={py(4.5)} y2={py(4.5)} />
          {placed.map((p, i) => {
            const x = sx(i, placed.length), y = py(p.place);
            return p.place === 1
              ? <rect key={i} className="ct-pt won" x={x - 3.2} y={y - 3.2} width="6.4" height="6.4" transform={`rotate(45 ${x} ${y})`} />
              : p.place <= 4 ? <circle key={i} className="ct-pt top4" cx={x} cy={y} r="3" /> : <circle key={i} className="ct-pt lost" cx={x} cy={y} r="2.6" />;
          })}
          {places.length > 1 && <polyline className="ct-roll" points={poly(rolling(places), py)} />}
        </Small>
        <Small name="Top 4 rate" value={f.top4 === null ? '-' : `${Math.round(f.top4)}%`} delta={<Delta v={f.top4D} better="up" unit="%" digits={0} />}>
          <line className="ct-ref" x1={SP} x2={SW - SP} y1={ty(50)} y2={ty(50)} />
          {top4.length > 1 && <polygon className="ct-sarea" points={`${sx(0, top4.length)},${SH - SP} ${poly(top4, ty)} ${sx(top4.length - 1, top4.length)},${SH - SP}`} />}
          {top4.length > 1 && <polyline className="ct-roll" points={poly(top4, ty)} />}
        </Small>
        <Small name="APM" value={f.apm === null ? '-' : f.apm.toFixed(1)} delta={<Delta v={f.apmD} better="up" />}>
          {apms.map((a, i) => <circle key={i} className="ct-pt faint" cx={sx(i, apms.length)} cy={ay(a)} r="2" />)}
          {apms.length > 1 && <polyline className="ct-roll" points={poly(rolling(apms), ay)} />}
        </Small>
        <Small name="Games" value={String(cur.length)} delta={prev ? <span className="ct-delta neutral">{prev.length} the period before</span> : null}>
          {cur.length > 0 && (() => {
            // Games per day across the window, as thin bars (the volume behind the other three).
            const span = window_ === 'all' ? Math.max(1, Math.ceil((nowMs - cur[0]!.atMs) / DAY)) : window_;
            const days = Math.min(span, 30);
            const per = new Array<number>(days).fill(0);
            const start = nowMs - days * DAY;
            for (const p of cur) { const d = Math.floor((p.atMs - start) / DAY); if (d >= 0 && d < days) per[d]!++; }
            const hi = Math.max(1, ...per);
            const bw = (SW - 2 * SP) / days;
            return per.map((n, i) => n > 0 && <rect key={i} className="ct-bar" x={SP + i * bw + 0.5} y={SH - SP - (n / hi) * (SH - 2 * SP)} width={Math.max(1, bw - 1)} height={(n / hi) * (SH - 2 * SP)} rx="1" />);
          })()}
        </Small>
      </div>
      <div className="ct-legend" aria-hidden="true">
        <span><i className="ct-key won" />1st</span><span><i className="ct-key top4" />Top 4</span><span><i className="ct-key lost" />5th to 8th</span><span><i className="ct-key roll" />Last {ROLL} games</span>
      </div>
    </>
  );
}
