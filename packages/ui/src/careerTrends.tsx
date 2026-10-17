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
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getHero } from '@game/sim';
import type { BoardMinion } from '@game/core';
import type { RunCosmeticSnapshot } from '@game/progression';
import { createPortal } from 'react-dom';
import { StoredTeam } from './StoredTeam';
import { rectToStage, stageHost, stageViewport } from './stage';
import { opponentSkins } from './skins/skins';
import { useGame } from './store';
import { apmOf, isMatchWin, ordinalOf, playedOnText, type CareerRun, type TrendWindow } from './careerData';
import { medalOf, POINTS_PER_DIVISION } from './rank/types';

const ROLL = 10;
const DAY = 86_400_000;

interface RunPoint { atMs: number; place: number | null; mmr: number | null; delta: number | null; heroId: string; apm: number | null;
  /** The run's final board (the stored array, a stable reference) and its recorded skins, for the MMR tip's board. */
  minions?: readonly BoardMinion[]; cosmetics?: RunCosmeticSnapshot | null }

/** Runs inside the window (oldest first), plus the previous window of the same length for the deltas. Pure. */
export function trendRuns(runs: readonly CareerRun[], window_: TrendWindow, nowMs: number): { cur: RunPoint[]; prev: RunPoint[] | null } {
  const toPoint = (r: CareerRun): RunPoint => ({
    atMs: r.atMs, place: r.placement, mmr: r.ratingAfter === null ? null : Math.round(r.ratingAfter), delta: r.ratingDelta, heroId: r.heroId, apm: apmOf(r), ...(r.board && r.board.minions.length > 0 ? { minions: r.board.minions, cosmetics: r.board.cosmetics ?? null } : {}),
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

const MW = 284, MH = 128, ML = 6, MR = 70, MT = 14, MB = 20;

/** The hovered run's final board in the MMR tip: the real cards (frame, stars, Attack / Health badges) at ~68px, the
 *  game card's strip renderer. Memoised on the stored minions array, so moving the crosshair to another point swaps
 *  this one node and nothing else re-renders; the cards' keyword animations stay paused (styles: .ct-board). */
const TipBoard = memo(function TipBoard({ minions, skins }: { minions: readonly BoardMinion[]; skins: RunCosmeticSnapshot | null }) {
  return <div className="ct-board"><StoredTeam minions={minions} skins={skins} label="Final board" compact /></div>;
});

/** Tip footprint in stage px (the board makes it wide); the tip is clamped to the stage with this. */
const TIP_W = 780, TIP_H_BOARD = 260, TIP_H_TEXT = 104;

// ── The focused (big) chart ────────────────────────────────────────────────────────────────────────────────────
// FOCUS (owner 2026-10-16: "let the player click each graph to 'focus' it and show it in the larger view"): any of
// the five charts can sit in the big slot; the other four are the small grid. Each kind builds its big GEOMETRY once
// per focus / range change (memoised): the static SVG, the per-game anchor points and the tooltip headline. The
// crosshair only reads those cached points; the floating tip is shared (the run's final board as real cards).

export type ChartKind = 'mmr' | 'place' | 'top4' | 'apm' | 'games';
export const CHART_KINDS: readonly ChartKind[] = ['mmr', 'place', 'top4', 'apm', 'games'];
const CHART_NAME: Record<ChartKind, string> = { mmr: 'MMR', place: 'Placement', top4: 'Top 4 rate', apm: 'APM', games: 'Games' };
const FOCUS_KEY = 'ascent.career.trendFocus';
function readFocus(): ChartKind {
  try { const v = localStorage.getItem(FOCUS_KEY) as ChartKind | null; return v && CHART_KINDS.includes(v) ? v : 'mmr'; } catch { return 'mmr'; }
}

interface Anchor { x: number; y: number; p: RunPoint & { now?: true }; head: ReactNode }
interface BigGeo { svg: ReactNode; anchors: Anchor[]; label: string }

const placeY = (v: number): number => MT + ((v - 1) / 7) * (MH - MT - MB);
const xAt = (i: number, n: number): number => (n <= 1 ? ML + (MW - ML - MR) / 2 : ML + (i / (n - 1)) * (MW - ML - MR));
const ptsLine = (xs: readonly number[], ys: readonly number[]): string => xs.map((x, i) => `${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(' ');
const dayText = (ms: number): string => playedOnText(ms).replace(/, \d{4}$/, '');
const placeHead = (p: RunPoint): ReactNode => <span>{p.place !== null ? ordinalOf(p.place) : 'No placement'}{p.heroId ? `, ${getHero(p.heroId).name}` : ''}</span>;

/** Date labels under any per-game chart: first, middle and last game. */
function dateTicks(xs: readonly number[], pts: readonly RunPoint[]): ReactNode {
  if (xs.length === 0) return null;
  const idx = xs.length > 2 ? [0, Math.floor(xs.length / 2), xs.length - 1] : xs.length === 2 ? [0, 1] : [0];
  return idx.map((i, k) => <text key={k} className="ct-date" x={xs[i]} y={MH - 6} textAnchor={k === 0 ? 'start' : k === idx.length - 1 ? 'end' : 'middle'}>{dayText(pts[i]!.atMs)}</text>);
}
/** A right-hand axis label column (the MMR chart's band names sit there too). */
const axisLabel = (y: number, t: string, k: string): ReactNode => <text key={k} className="ct-band-l" x={MW - MR + 6} y={y + 4}>{t}</text>;

function mmrGeo(pts: readonly RunPoint[], live: number | null, nowMs: number): BigGeo | null {
  const rated = pts.filter((p) => p.mmr !== null) as Array<RunPoint & { mmr: number; now?: true }>;
  const lastPt = rated[rated.length - 1];
  // The line ENDS on the live rating the crest prints (owner 2026-10-03): a closing "now" point, not a run.
  if (live !== null && lastPt && lastPt.mmr !== live) rated.push({ atMs: Math.max(nowMs, lastPt.atMs), place: null, mmr: live, delta: null, heroId: '', apm: null, now: true });
  if (rated.length === 0) return null;
  const ys = rated.map((p) => p.mmr);
  const lo = Math.max(0, Math.floor((Math.min(...ys) - 1) / POINTS_PER_DIVISION) * POINTS_PER_DIVISION);
  const hi = Math.max(lo + POINTS_PER_DIVISION, Math.ceil((Math.max(...ys) + 1) / POINTS_PER_DIVISION) * POINTS_PER_DIVISION);
  const ih = MH - MT - MB;
  const yOf = (v: number): number => MT + (1 - (v - lo) / (hi - lo)) * ih;
  const xs = rated.map((_, i) => xAt(i, rated.length));
  const yv = rated.map((p) => yOf(p.mmr));
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
  let peak = 0;
  for (let i = 1; i < rated.length; i++) if (rated[i]!.mmr > rated[peak]!.mmr) peak = i;
  const line = ptsLine(xs, yv);
  const n = rated.length;
  const area = `${xs[0]!.toFixed(1)},${(MH - MB).toFixed(1)} ${line} ${xs[n - 1]!.toFixed(1)},${(MH - MB).toFixed(1)}`;
  const svg = (
    <>
      <defs>
        <linearGradient id="ct-mmr-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#e8c877" stopOpacity="0.32" />
          <stop offset="1" stopColor="#e8c877" stopOpacity="0" />
        </linearGradient>
      </defs>
      {bands.map((b) => (
        <g key={b.name}>
          <rect className={`ct-band${b.k % 2 ? ' alt' : ''}`} x={ML} y={b.y0} width={MW - ML - MR} height={Math.max(0, b.y1 - b.y0)} />
          {b.y1 - b.y0 >= 11 && <text className="ct-band-l" x={MW - MR + 6} y={(b.y0 + b.y1) / 2 + 4}>{b.name}</text>}
        </g>
      ))}
      {ticks.filter((_, i) => i % step === 0 || i === ticks.length - 1).map((t) => <line key={t} className="ct-grid" x1={ML} x2={MW - MR} y1={yOf(t)} y2={yOf(t)} />)}
      {n > 1 && <polygon className="ct-area" points={area} fill="url(#ct-mmr-fill)" />}
      {n > 1 && <polyline className="ct-glow" points={line} />}
      {n > 1 && <polyline className="ct-line" points={line} />}
      {n > 1 && (
        <g className="ct-peak">
          <circle cx={xs[peak]} cy={yv[peak]} r="3.5" />
          <text x={Math.min(xs[peak]!, MW - MR - 50)} y={Math.max(11, yv[peak]! - 7)}>Peak {rated[peak]!.mmr}</text>
        </g>
      )}
      <circle className="ct-last" cx={xs[n - 1]} cy={yv[n - 1]} r="4.5" />
      {dateTicks(xs, rated)}
    </>
  );
  const anchors = rated.map((p, i) => ({
    x: xs[i]!, y: yv[i]!, p,
    head: <>
      <b>{p.mmr} MMR</b>
      {p.delta !== null && p.delta !== 0 && <span className={p.delta > 0 ? 'good' : 'bad'}>{p.delta > 0 ? `+${p.delta}` : p.delta}</span>}
      {p.now ? <span>Your rating now</span> : placeHead(p)}
    </>,
  }));
  return { svg, anchors, label: `MMR after each rated run, latest ${rated[n - 1]!.mmr}` };
}

function placeGeo(pts: readonly RunPoint[]): BigGeo | null {
  const placed = pts.filter((p) => p.place !== null) as Array<RunPoint & { place: number }>;
  if (placed.length === 0) return null;
  const xs = placed.map((_, i) => xAt(i, placed.length));
  const ys = placed.map((p) => placeY(p.place));
  const roll = rolling(placed.map((p) => p.place)).map(placeY);
  const w = MW - ML - MR;
  const svg = (
    <>
      {/* Placement bands: the win line, top 4 (green) and 5th to 8th (red). */}
      <rect className="ct-pband top4" x={ML} y={placeY(1) - 4} width={w} height={placeY(4.5) - placeY(1) + 4} />
      <rect className="ct-pband lost" x={ML} y={placeY(4.5)} width={w} height={placeY(8) - placeY(4.5) + 4} />
      {[1, 4, 8].map((v) => <line key={v} className="ct-grid" x1={ML} x2={ML + w} y1={placeY(v)} y2={placeY(v)} />)}
      <line className="ct-ref" x1={ML} x2={ML + w} y1={placeY(4.5)} y2={placeY(4.5)} />
      {axisLabel(placeY(1), '1st', 'a1')}{axisLabel(placeY(4), '4th', 'a4')}{axisLabel(placeY(8), '8th', 'a8')}
      {placed.map((p, i) => (p.place === 1
        ? <rect key={i} className="ct-pt won" x={xs[i]! - 3.4} y={ys[i]! - 3.4} width="6.8" height="6.8" transform={`rotate(45 ${xs[i]} ${ys[i]})`} />
        : <circle key={i} className={`ct-pt ${p.place <= 4 ? 'top4' : 'lost'}`} cx={xs[i]} cy={ys[i]} r={p.place <= 4 ? 3.2 : 2.8} />))}
      {placed.length > 1 && <polyline className="ct-roll" points={ptsLine(xs, roll)} />}
      {dateTicks(xs, placed)}
    </>
  );
  return { svg, anchors: placed.map((p, i) => ({ x: xs[i]!, y: ys[i]!, p, head: <><b>{ordinalOf(p.place)}</b>{p.heroId && <span>{getHero(p.heroId).name}</span>}</> })), label: 'Placement of each game, with the last 10 games average' };
}

function top4Geo(pts: readonly RunPoint[]): BigGeo | null {
  const placed = pts.filter((p) => p.place !== null) as Array<RunPoint & { place: number }>;
  if (placed.length === 0) return null;
  const ih = MH - MT - MB;
  const ty = (v: number): number => MT + (1 - v / 100) * ih;
  const xs = placed.map((_, i) => xAt(i, placed.length));
  const roll = rolling(placed.map((p) => (isMatchWin(p.place) ? 100 : 0))).map(ty);
  const marks = placed.map((p) => (isMatchWin(p.place) ? ty(100) : ty(0)));
  const n = placed.length;
  const line = ptsLine(xs, roll);
  const svg = (
    <>
      {[0, 100].map((v) => <line key={v} className="ct-grid" x1={ML} x2={MW - MR} y1={ty(v)} y2={ty(v)} />)}
      <line className="ct-ref" x1={ML} x2={MW - MR} y1={ty(50)} y2={ty(50)} />
      {axisLabel(ty(100), '100%', 'a100')}{axisLabel(ty(50), '50%', 'a50')}{axisLabel(ty(0), '0%', 'a0')}
      {n > 1 && <polygon className="ct-sarea" points={`${xs[0]},${ty(0)} ${line} ${xs[n - 1]},${ty(0)}`} />}
      {placed.map((p, i) => <circle key={i} className={`ct-pt ${isMatchWin(p.place) ? 'top4' : 'lost'}`} cx={xs[i]} cy={marks[i]} r="2.4" />)}
      {n > 1 && <polyline className="ct-roll" points={line} />}
      {dateTicks(xs, placed)}
    </>
  );
  return {
    svg,
    anchors: placed.map((p, i) => ({ x: xs[i]!, y: roll[i]!, p, head: <><b>{isMatchWin(p.place) ? 'Top 4' : 'Not top 4'}</b><span>Last 10: {Math.round(100 - ((roll[i]! - MT) / ih) * 100)}%</span>{placeHead(p)}</> })),
    label: 'Top 4 rate over the last 10 games',
  };
}

function apmGeo(pts: readonly RunPoint[]): BigGeo | null {
  const withApm = pts.filter((p) => p.apm !== null) as Array<RunPoint & { apm: number }>;
  if (withApm.length === 0) return null;
  const hi = Math.max(1, Math.ceil(Math.max(...withApm.map((p) => p.apm)) * 1.15 * 2) / 2);
  const ih = MH - MT - MB;
  const ay = (v: number): number => MT + (1 - v / hi) * ih;
  const xs = withApm.map((_, i) => xAt(i, withApm.length));
  const ys = withApm.map((p) => ay(p.apm));
  const roll = rolling(withApm.map((p) => p.apm)).map(ay);
  const svg = (
    <>
      {[0, hi / 2, hi].map((v, k) => <line key={k} className="ct-grid" x1={ML} x2={MW - MR} y1={ay(v)} y2={ay(v)} />)}
      {axisLabel(ay(hi), hi.toFixed(1), 'ah')}{axisLabel(ay(hi / 2), (hi / 2).toFixed(1), 'am')}{axisLabel(ay(0), '0', 'a0')}
      {withApm.map((p, i) => <circle key={i} className="ct-pt faint" cx={xs[i]} cy={ys[i]} r="2.4" />)}
      {withApm.length > 1 && <polyline className="ct-roll" points={ptsLine(xs, roll)} />}
      {dateTicks(xs, withApm)}
    </>
  );
  return { svg, anchors: withApm.map((p, i) => ({ x: xs[i]!, y: ys[i]!, p, head: <><b>{p.apm.toFixed(1)} APM</b>{placeHead(p)}</> })), label: 'Actions per minute in each game' };
}

function gamesGeo(pts: readonly RunPoint[], window_: TrendWindow, nowMs: number): BigGeo | null {
  if (pts.length === 0) return null;
  const span = window_ === 'all' ? Math.max(1, Math.ceil((nowMs - pts[0]!.atMs) / DAY)) : window_;
  const days = Math.min(span, 30);
  const start = nowMs - days * DAY;
  const per: Array<RunPoint[]> = Array.from({ length: days }, () => []);
  for (const p of pts) { const d = Math.floor((p.atMs - start) / DAY); if (d >= 0 && d < days) per[d]!.push(p); }
  const hi = Math.max(1, ...per.map((g) => g.length));
  const w = MW - ML - MR, ih = MH - MT - MB;
  const bw = w / days;
  const svg = (
    <>
      <line className="ct-grid" x1={ML} x2={ML + w} y1={MT + ih} y2={MT + ih} />
      {axisLabel(MT, `${hi} a day`, 'ahi')}
      {per.map((g, i) => {
        if (g.length === 0) return null;
        const h = (g.length / hi) * (ih - 10);
        const x = ML + i * bw;
        return (
          <g key={i}>
            <rect className="ct-bar" x={x + 1} y={MT + ih - h} width={Math.max(1.5, bw - 2)} height={h} rx="1.5" />
            {bw >= 9 && <text className="ct-barlabel" x={x + bw / 2} y={MT + ih - h - 3} textAnchor="middle">{g.length}</text>}
          </g>
        );
      })}
      <text className="ct-date" x={ML} y={MH - 6} textAnchor="start">{dayText(start + DAY / 2)}</text>
      <text className="ct-date" x={ML + w} y={MH - 6} textAnchor="end">{dayText(nowMs)}</text>
    </>
  );
  const anchors: Anchor[] = [];
  per.forEach((g, i) => {
    if (g.length === 0) return;
    const last = g[g.length - 1]!;
    anchors.push({ x: ML + i * bw + bw / 2, y: MT + ih - (g.length / hi) * (ih - 10), p: last, head: <><b>{g.length} {g.length === 1 ? 'game' : 'games'}</b><span>{dayText(last.atMs)}. The last one: </span>{placeHead(last)}</> });
  });
  return { svg, anchors, label: 'Games played each day' };
}

/** The big chart: a memoised static SVG + cached anchors; the crosshair snaps to the nearest anchor by x. */
function BigChart({ geo, own, kind }: { geo: BigGeo | null; own: boolean; kind: ChartKind }) {
  const showOpp = useGame((s) => s.showOpponentSkins);
  const wrap = useRef<HTMLDivElement>(null);
  const rect = useRef<{ left: number; width: number } | null>(null);
  // The chart's rect in STAGE px, read once per hover (never per move): where the floating tip is seated from.
  const stageRect = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // The board follows the crosshair only once it RESTS on a point (~90 ms): sweeping the chart swaps the text line per
  // point, never seven real cards per point (measured 2026-10-16).
  const [rested, setRested] = useState<number | null>(null);
  useEffect(() => {
    if (hover === null) { setRested(null); return undefined; }
    const t = window.setTimeout(() => setRested(hover), 90);
    return () => window.clearTimeout(t);
  }, [hover]);
  useEffect(() => { setHover(null); }, [geo]);
  if (!geo || geo.anchors.length === 0) return <div className="ct-empty">{kind === 'mmr' ? 'No rated runs in this window' : 'No games in this window'}</div>;
  const h = hover === null ? null : geo.anchors[hover] ?? null;
  const onMove = (e: React.PointerEvent): void => {
    if (!rect.current && wrap.current) { const r = wrap.current.getBoundingClientRect(); rect.current = { left: r.left, width: r.width }; stageRect.current = rectToStage(r); }
    const r = rect.current; if (!r) return;
    const x = ((e.clientX - r.left) / r.width) * MW;
    let best = 0;
    for (let i = 1; i < geo.anchors.length; i++) if (Math.abs(geo.anchors[i]!.x - x) < Math.abs(geo.anchors[best]!.x - x)) best = i;
    if (best !== hover) setHover(best);
  };
  return (
    <div className="ct-mmr" ref={wrap} onPointerEnter={() => { rect.current = null; stageRect.current = null; }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${MW} ${MH}`} role="img" aria-label={geo.label}>
        {geo.svg}
        {h && <line className="ct-cross" x1={h.x} x2={h.x} y1={MT} y2={MH - MB} />}
        {h && <circle className="ct-hot" cx={h.x} cy={h.y} r="5" />}
      </svg>
      {h && stageRect.current && (() => {
        // A FLOATING tip over everything (owner 2026-10-16: "show the full minion w/ stats"): portalled into the stage,
        // seated above the point (below when there is no room), clamped inside the stage on every side.
        const sr = stageRect.current;
        const vp = stageViewport();
        const ax = sr.left + (h.x / MW) * sr.width;
        const ay = sr.top + (h.y / MH) * sr.height;
        const board = !!h.p.minions && h.p.minions.length > 0;
        const showBoard = board && rested === hover;
        const w = board ? TIP_W : 220;
        const th = board ? TIP_H_BOARD : TIP_H_TEXT;
        const left = Math.max(8, Math.min(vp.w - w - 8, ax - w / 2));
        const top = ay - th - 14 >= 8 ? ay - th - 14 : Math.min(vp.h - th - 8, ay + 14);
        return createPortal(
          <div className={`atip ct-pos ct-float${board ? ' ct-wide' : ''}`} style={{ left, top, width: w }} role="tooltip">
            <div className="ct-headline">
              {h.head}
              <span className="dim">{playedOnText(h.p.atMs)}</span>
            </div>
            {showBoard && <TipBoard minions={h.p.minions!} skins={own ? h.p.cosmetics ?? null : opponentSkins(showOpp, h.p.cosmetics ?? undefined)} />}
          </div>,
          stageHost(),
        );
      })()}
    </div>
  );
}

// ── The small multiples ────────────────────────────────────────────────────────────────────────────────────────

const SW = 134, SH = 78, SP = 6;

/** A small chart: a button that focuses it (lift on hover, "Click to focus" in the game's tip bubble). */
function Small({ kind, value, delta, onFocus, children }: { kind: ChartKind; value: string; delta: JSX.Element | null; onFocus: (k: ChartKind) => void; children: ReactNode }) {
  return (
    <button type="button" className="ct-small gtip" data-tip="Click to focus" data-kind={kind} aria-label={`${CHART_NAME[kind]}: ${value}. Show it large`} onClick={() => onFocus(kind)}>
      <div className="ct-small-head"><span className="ct-small-t">{CHART_NAME[kind]}</span><span className="ct-small-v">{value}</span></div>
      <svg viewBox={`0 0 ${SW} ${SH}`} preserveAspectRatio="none" aria-hidden="true">{children}</svg>
      <div className="ct-small-d">{delta}</div>
    </button>
  );
}

const sx = (i: number, n: number): number => (n <= 1 ? SW / 2 : SP + (i / (n - 1)) * (SW - 2 * SP));
const syOf = (lo: number, hi: number, invert = false) => (v: number): number => {
  const t = (v - lo) / Math.max(1e-9, hi - lo);
  return SP + (invert ? t : 1 - t) * (SH - 2 * SP);
};
const poly = (ys: readonly number[], y: (v: number) => number): string => ys.map((v, i) => `${sx(i, ys.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

export function TrendsBody({ runs, window_, nowMs, live, own = true }: { runs: readonly CareerRun[]; window_: TrendWindow; nowMs: number; live: number | null; own?: boolean }) {
  const { cur, prev } = useMemo(() => trendRuns(runs, window_, nowMs), [runs, window_, nowMs]);
  const f = useMemo(() => trendFigures(cur, prev), [cur, prev]);
  const [focus, setFocusState] = useState<ChartKind>(readFocus);
  const setFocus = (k: ChartKind): void => { setFocusState(k); try { localStorage.setItem(FOCUS_KEY, k); } catch { /* per device only */ } };
  // The focused chart's geometry: rebuilt only when the focus, the range or the data change (never on hover).
  const geo = useMemo<BigGeo | null>(() => (
    focus === 'mmr' ? mmrGeo(cur, live, nowMs) : focus === 'place' ? placeGeo(cur) : focus === 'top4' ? top4Geo(cur) : focus === 'apm' ? apmGeo(cur) : gamesGeo(cur, window_, nowMs)
  ), [focus, cur, live, nowMs, window_]);
  const placed = cur.filter((p) => p.place !== null) as Array<RunPoint & { place: number }>;
  const places = placed.map((p) => p.place);
  const top4 = rolling(places.map((p) => (isMatchWin(p) ? 100 : 0)));
  const apms = cur.map((p) => p.apm).filter((a): a is number => a !== null);
  const apmHi = Math.max(10, Math.ceil(Math.max(0, ...apms) / 10) * 10);
  const mmrs = cur.map((p) => p.mmr).filter((m): m is number => m !== null);
  const py = syOf(1, 8, true);
  const ty = syOf(0, 100);
  const ay = syOf(0, apmHi);
  const my = syOf(Math.min(...mmrs, live ?? Infinity), Math.max(...mmrs, live ?? -Infinity, Math.min(...mmrs, live ?? Infinity) + 1));
  const value: Record<ChartKind, string> = {
    mmr: String(live ?? (mmrs[mmrs.length - 1] ?? '-')),
    place: f.place === null ? '-' : f.place.toFixed(1),
    top4: f.top4 === null ? '-' : `${Math.round(f.top4)}%`,
    apm: f.apm === null ? '-' : f.apm.toFixed(1),
    games: String(cur.length),
  };
  const delta: Record<ChartKind, JSX.Element | null> = {
    mmr: null,
    place: <Delta v={f.placeD} better="down" />,
    top4: <Delta v={f.top4D} better="up" unit="%" digits={0} />,
    apm: <Delta v={f.apmD} better="up" />,
    games: prev ? <span className="ct-delta neutral">{prev.length} the period before</span> : null,
  };
  const smallBody = (k: ChartKind): ReactNode => {
    if (k === 'mmr') return mmrs.length > 1 ? <polyline className="ct-roll gold" points={poly(mmrs, my)} /> : null;
    if (k === 'place') {
      return <>
        <line className="ct-ref" x1={SP} x2={SW - SP} y1={py(4.5)} y2={py(4.5)} />
        {placed.map((p, i) => {
          const x = sx(i, placed.length), y = py(p.place);
          return p.place === 1
            ? <rect key={i} className="ct-pt won" x={x - 3.2} y={y - 3.2} width="6.4" height="6.4" transform={`rotate(45 ${x} ${y})`} />
            : p.place <= 4 ? <circle key={i} className="ct-pt top4" cx={x} cy={y} r="3" /> : <circle key={i} className="ct-pt lost" cx={x} cy={y} r="2.6" />;
        })}
        {places.length > 1 && <polyline className="ct-roll" points={poly(rolling(places), py)} />}
      </>;
    }
    if (k === 'top4') {
      return <>
        <line className="ct-ref" x1={SP} x2={SW - SP} y1={ty(50)} y2={ty(50)} />
        {top4.length > 1 && <polygon className="ct-sarea" points={`${sx(0, top4.length)},${SH - SP} ${poly(top4, ty)} ${sx(top4.length - 1, top4.length)},${SH - SP}`} />}
        {top4.length > 1 && <polyline className="ct-roll" points={poly(top4, ty)} />}
      </>;
    }
    if (k === 'apm') {
      return <>
        {apms.map((a, i) => <circle key={i} className="ct-pt faint" cx={sx(i, apms.length)} cy={ay(a)} r="2" />)}
        {apms.length > 1 && <polyline className="ct-roll" points={poly(rolling(apms), ay)} />}
      </>;
    }
    if (cur.length === 0) return null;
    // Games per day across the window, as thin bars (the volume behind the other charts).
    const span = window_ === 'all' ? Math.max(1, Math.ceil((nowMs - cur[0]!.atMs) / DAY)) : window_;
    const days = Math.min(span, 30);
    const per = new Array<number>(days).fill(0);
    const start = nowMs - days * DAY;
    for (const p of cur) { const d = Math.floor((p.atMs - start) / DAY); if (d >= 0 && d < days) per[d]!++; }
    const hi = Math.max(1, ...per);
    const bw = (SW - 2 * SP) / days;
    return per.map((n, i) => n > 0 && <rect key={i} className="ct-bar" x={SP + i * bw + 0.5} y={SH - SP - (n / hi) * (SH - 2 * SP)} width={Math.max(1, bw - 1)} height={(n / hi) * (SH - 2 * SP)} rx="1" />);
  };
  return (
    <>
      <div className="ct-mmr-head"><span className="cv2-trend-title">{CHART_NAME[focus]}</span><span className="cv2-trend-avg">{value[focus]}</span>{focus !== 'mmr' && <span className="ct-focus-d">{delta[focus]}</span>}</div>
      {/* Keyed on the focus: a swap crossfades the new chart in (opacity, one-shot). */}
      <div className="ct-focus" key={focus}><BigChart geo={geo} own={own} kind={focus} /></div>
      <div className="ct-grid2">
        {CHART_KINDS.filter((k) => k !== focus).map((k) => (
          <Small key={k} kind={k} value={value[k]} delta={delta[k]} onFocus={setFocus}>{smallBody(k)}</Small>
        ))}
      </div>
      <div className="ct-legend" aria-hidden="true">
        <span><i className="ct-key won" />1st</span><span><i className="ct-key top4" />Top 4</span><span><i className="ct-key lost" />5th to 8th</span><span><i className="ct-key roll" />Last {ROLL} games</span>
      </div>
    </>
  );
}
