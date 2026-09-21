import type { Tribe } from '@game/core';
import type { BoardSnapshot, ReplayV2 } from '@game/sim';

/**
 * CAREER PAGE DATA (owner rebuild 2026-09-19) — the pure half of the Career page: the run row model the page
 * renders, how a row is assembled from the server tables, and every number the three columns print.
 *
 * WHERE THE NUMBERS COME FROM (the contract the page + tests pin):
 *  - `run_history` is the per-account run log (one row per finished lobby run, the whole `RunHistoryEntry`
 *    in its `entry` jsonb). It carries hero, round reached, the W–L–D record, placement, the FINAL BOARD,
 *    Gold spent, actions-per-round, the rating delta, the run's seed and its end time. (The `runs` table is
 *    the Hall of Champions — 1st-place finishes only — so it cannot be the match history.)
 *  - `run_telemetry` carries the v2 replay. A LIGHT probe (JSON-path scalars, never the payload) tells us per
 *    run whether a watchable replay exists (→ WATCH REPLAY) and the recording's first/last frame clock (→ run
 *    length). The two tables share no id; the run's SEED is the join (the same key `fetchReplayForSeed` uses).
 *  - The run's RUNES ride inside the final board snapshot (`board.runes`, stamped from the run's `ownedRunes`
 *    by `snapshotOf`) — no extra column or table; a run with no board (or none picked) shows "No runes recorded".
 *  - Anything neither table has prints "—". No server columns were added for this page.
 *
 * Everything here is pure and synchronous so it is testable without a client: the fetch lives in
 * `remoteBoards.ts` and hands its raw rows to `careerRunOf` / `joinTelemetry`.
 */

/** One run as the Career page renders it. `board` is only populated on the newest N rows (the match history);
 *  the trend / aggregate rows beyond those are fetched light (scalars only) and carry `board: null`. */
export interface CareerRun {
  /** `run_history.id` — the row key. Null only on a malformed row. */
  id: number | null;
  heroId: string;
  /** When the run ended — the entry's `at` (full datetime) when present, else the row's `created_at`. */
  at: string | null;
  /** `at` as an epoch (ms); NaN when unknown. */
  atMs: number;
  wave: number;
  wins: number;
  losses: number;
  draws: number;
  /** Lobby finish 1–8; null when the row has none (a pre-lobby run) and no telemetry row supplied one. */
  placement: number | null;
  goldSpent: number | null;
  /** Actions per round as stamped at run end (player decisions / rounds). Null on entries before it existed. */
  apt: number | null;
  ratingDelta: number | null;
  seed: number | null;
  dominantTribe: Tribe | null;
  mode: string | null;
  /** The final warband — only on the detailed (newest) rows; null on light rows AND on runs with no board. */
  board: BoardSnapshot | null;
  /** True when this row was fetched with its full entry (so a null `board` means "no board stored", not
   *  "not fetched"). The page shows the outcome-only banner for a detailed row with no board. */
  detailed: boolean;
  /** The runes the run picked — rune ids in acquisition order (Rune of Duplication legitimately repeats one).
   *  Read off the final board snapshot's `runes` (`snapshotOf` stamps the run's `ownedRunes` there), so only a
   *  detailed row with a board can carry them; empty = "No runes recorded". */
  runes: string[];
  /** `run_telemetry.id` of a WATCHABLE v2 replay for this run — the handle `fetchReplayPayload` takes. Null =
   *  no replay (the button renders disabled). */
  replayRowId: number | null;
  /** The recording's clock span (last frame − first frame), ms. Null without a telemetry row. */
  durationMs: number | null;
}

/** The subset of a `run_history` row the page reads — either the full `entry` (detailed) or the JSON-path
 *  scalars the light select projects out of it. Every field optional: rows predate most of them. */
export interface RunHistoryRowLike {
  id?: unknown;
  created_at?: unknown;
  hero_id?: unknown;
  wave?: unknown;
  wins?: unknown;
  placement?: unknown;
  mode?: unknown;
  /** The full entry (detailed select). */
  entry?: unknown;
  /** Light-select aliases (`x:entry->>x`) — PostgREST returns `->>` scalars as TEXT, so these are parsed. */
  losses?: unknown; draws?: unknown; apt?: unknown; seed?: unknown; gold_spent?: unknown;
  rating_delta?: unknown; at?: unknown; dominant_tribe?: unknown;
}

/** One `run_telemetry` row as the LIGHT probe projects it — scalars only, never the replay payload. */
export interface TelemetryProbeRow {
  id?: unknown;
  /** `replay->>seed` (text). */
  seed?: unknown;
  /** `replay->v2->>version` ('2' on a watchable row). */
  v2_version?: unknown;
  /** `replay->v2->frames->0->>tMs` / `replay->v2->frames->-1->>tMs` (text numbers). */
  first_t?: unknown;
  last_t?: unknown;
  placement?: unknown;
  created_at?: unknown;
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

const TRIBES: readonly Tribe[] = ['beast', 'dragon', 'mech', 'undead', 'demon', 'neutral', 'kobold', 'dwarf', 'celestial', 'spirit'];
const tribeOf = (v: unknown): Tribe | null => (typeof v === 'string' && (TRIBES as readonly string[]).includes(v) ? (v as Tribe) : null);

/** Human tribe names for the Favorite Tribe tile. */
export const TRIBE_LABEL: Record<Tribe, string> = {
  beast: 'Beast', dragon: 'Dragon', mech: 'Mech', undead: 'Undead', demon: 'Demon', neutral: 'Neutral', kobold: 'Kobold', dwarf: 'Dwarf',
  celestial: 'Celestial', spirit: 'Spirit',
};

/**
 * Shape one `run_history` row into a `CareerRun`. Reads the full `entry` when the row carries one (the
 * detailed select) and the light aliases otherwise; the scalar columns (`hero_id`, `wave`, `wins`,
 * `placement`) are the fallback for both. Never throws on a malformed row — fields it can't read are null.
 */
export function careerRunOf(row: RunHistoryRowLike): CareerRun {
  const e = (row.entry && typeof row.entry === 'object' ? row.entry : {}) as Record<string, unknown>;
  const detailed = !!row.entry && typeof row.entry === 'object';
  const at = str(e.at) ?? (str(e.date) ? `${str(e.date)}T00:00:00` : null) ?? str(row.at) ?? str(row.created_at);
  const atMs = at ? Date.parse(at) : NaN;
  const board = e.board && typeof e.board === 'object' && Array.isArray((e.board as BoardSnapshot).minions)
    ? (e.board as BoardSnapshot) : null;
  const runes = board && Array.isArray(board.runes) ? (board.runes as unknown[]).filter((id): id is string => typeof id === 'string' && id !== '') : [];
  return {
    id: num(row.id),
    heroId: str(e.heroId) ?? str(row.hero_id) ?? '',
    at, atMs,
    wave: num(e.wave) ?? num(row.wave) ?? 0,
    wins: num(e.wins) ?? num(row.wins) ?? 0,
    losses: num(e.losses) ?? num(row.losses) ?? 0,
    draws: num(e.draws) ?? num(row.draws) ?? 0,
    placement: positive(num(row.placement) ?? num(e.placement)),
    goldSpent: num(e.goldSpent) ?? num(row.gold_spent),
    apt: num(e.apt) ?? num(row.apt),
    ratingDelta: num(e.ratingDelta) ?? num(row.rating_delta),
    seed: num(e.seed) ?? num(row.seed),
    dominantTribe: tribeOf(e.dominantTribe) ?? tribeOf(row.dominant_tribe),
    mode: str(e.mode) ?? str(row.mode),
    board,
    detailed,
    runes,
    replayRowId: null,
    durationMs: null,
  };
}

const positive = (n: number | null): number | null => (n !== null && n > 0 ? n : null);

/** A telemetry probe row → the per-run facts the page wants from it. `hasReplay` needs BOTH a v2 version
 *  stamp and a numeric row id (the fetch handle). `durationMs` needs both frame clocks. */
export function telemetryFactsOf(r: TelemetryProbeRow): { rowId: number | null; seed: number | null; hasReplay: boolean; durationMs: number | null; placement: number | null } {
  const rowId = num(r.id);
  const v2 = r.v2_version === 2 || r.v2_version === '2';
  const first = num(r.first_t);
  const last = num(r.last_t);
  const durationMs = first !== null && last !== null && last >= first ? last - first : null;
  return { rowId, seed: num(r.seed), hasReplay: v2 && rowId !== null, durationMs, placement: positive(num(r.placement)) };
}

/**
 * Join the telemetry probe onto the history rows BY SEED (newest probe row wins on a duplicate seed). A run
 * with no telemetry row keeps `replayRowId`/`durationMs` null; a run with no placement of its own adopts the
 * telemetry row's. Pure — the fetch calls this after both queries land.
 */
export function joinTelemetry(runs: CareerRun[], probe: TelemetryProbeRow[]): CareerRun[] {
  const bySeed = new Map<number, ReturnType<typeof telemetryFactsOf>>();
  for (const r of probe) {
    const f = telemetryFactsOf(r);
    if (f.seed === null || bySeed.has(f.seed)) continue; // newest first → first sighting wins
    bySeed.set(f.seed, f);
  }
  return runs.map((run) => {
    const f = run.seed !== null ? bySeed.get(run.seed) : undefined;
    if (!f) return run;
    return {
      ...run,
      replayRowId: f.hasReplay ? f.rowId : null,
      durationMs: f.durationMs,
      placement: run.placement ?? f.placement,
    };
  });
}

// ── Per-run derivations ─────────────────────────────────────────────────────────────────────────────────

/** Player decisions this run ≈ actions-per-round × rounds (APT was stamped as decisions ÷ rounds to 0.1, so
 *  the product is within a decision of the true count). Null when the entry predates APT. */
export function actionsOf(run: Pick<CareerRun, 'apt' | 'wave'>): number | null {
  if (run.apt === null || run.wave <= 0) return null;
  return Math.round(run.apt * run.wave);
}

/** Actions per minute over the recording's clock — null without a length or an action count. */
export function apmOf(run: Pick<CareerRun, 'apt' | 'wave' | 'durationMs'>): number | null {
  const actions = actionsOf(run);
  if (actions === null || run.durationMs === null || run.durationMs <= 0) return null;
  return Math.round((actions / (run.durationMs / 60_000)) * 10) / 10;
}

/** "36 min" for the outcome block; "<1 min" under a minute; "—" when unknown. */
export function runLengthText(durationMs: number | null): string {
  if (durationMs === null || durationMs < 0) return '—';
  const mins = Math.round(durationMs / 60_000);
  return mins < 1 ? '<1 min' : `${mins} min`;
}

/** 1st / 2nd / 3rd / 4th … (11th–13th handled). Duplicated from runHistory.ts on purpose: this module must
 *  stay free of the local-storage history layer. */
export function ordinalOf(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** The outcome block's headline: 1st reads VICTORY (green); any other placement reads as its ordinal
 *  ("4TH"), top-4 in the neutral cream, 5th–8th in red; no placement at all reads "—". */
export function outcomeOf(placement: number | null): { label: string; cls: 'won' | 'top4' | 'lost' | 'none' } {
  if (placement === null) return { label: '—', cls: 'none' };
  if (placement === 1) return { label: 'VICTORY', cls: 'won' };
  return { label: ordinalOf(placement).toUpperCase(), cls: placement <= 4 ? 'top4' : 'lost' };
}

// ── The MATCH win (owner ruling 2026-09-20) ─────────────────────────────────────────────────────────────
//
// A match is WON by PLACEMENT — top 4 = W, 5th–8th = L. Fights (the per-round combat W–L the entry also
// carries) are no longer the unit anywhere on the Career page: the banner's record, the Heroes tab's record +
// win rate and the Win Rate trend all use this definition. A run with no placement is neither.

/** Top 4 = a match win; 5th–8th = a loss; no placement = null (unknown, counted in neither column). */
export function isMatchWin(placement: number | null): boolean | null {
  if (placement === null) return null;
  return placement <= 4;
}

/** The banner's placement outcome under the hero name: WIN (green) / LOSS (red) / "—". */
export function matchResultOf(placement: number | null): { label: string; cls: 'win' | 'loss' | 'none' } {
  const w = isMatchWin(placement);
  if (w === null) return { label: '—', cls: 'none' };
  return w ? { label: 'WIN', cls: 'win' } : { label: 'LOSS', cls: 'loss' };
}

/** "Sep 19, 2026" for the outcome block; '' when the time is unknown. */
export function playedOnText(atMs: number): string {
  if (!Number.isFinite(atMs)) return '';
  return new Date(atMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Replay-derived facts (a full v2 payload in hand) ────────────────────────────────────────────────────

/** What a full v2 replay says about its run — the same facts the light probe reads off the server, plus the
 *  ones only the frames carry (the true action count, Gold spent). Used when a payload IS in hand (the
 *  store's "Rewatch last game" replay, tests) and as the reference the probe's derivations are checked against. */
export function replaySummary(replay: ReplayV2): {
  placement: number | null;
  record: { wins: number; losses: number; draws: number };
  durationMs: number | null;
  actions: number;
  goldSpent: number | null;
  apm: number | null;
} {
  const frames = replay.frames;
  const first = frames[0];
  const last = frames[frames.length - 1];
  const durationMs = first && last && last.tMs >= first.tMs ? last.tMs - first.tMs : null;
  let actions = 0;
  let goldSpent: number | null = null;
  for (const f of frames) {
    if (f.kind === 'shop') {
      if (f.cause !== 'turnStart') actions++;
      const g = (f.view as { goldSpent?: unknown }).goldSpent;
      if (typeof g === 'number') goldSpent = g;
    } else if (f.kind === 'shopDelta') {
      if (f.cause !== 'turnStart') actions++;
      const g = (f.changed as { goldSpent?: unknown }).goldSpent;
      if (typeof g === 'number') goldSpent = g;
    }
  }
  const placement = positive(replay.result?.placement ?? null);
  const record = replay.result?.record ?? { wins: 0, losses: 0, draws: 0 };
  const apm = durationMs !== null && durationMs > 0 ? Math.round((actions / (durationMs / 60_000)) * 10) / 10 : null;
  return { placement, record, durationMs, actions, goldSpent, apm };
}

// ── Left column aggregates ──────────────────────────────────────────────────────────────────────────────

export interface CareerAggregates {
  runs: number;
  /** Most-played hero (ties → the one played most recently). Null with no runs. */
  mostPlayedHero: string | null;
  /** Placement-1 finishes. */
  firsts: number;
  /** Top-4 finishes as a whole percent of the runs that recorded a placement; null when none did. */
  top4Pct: number | null;
  /** Mean placement to one decimal over the runs that recorded one; null when none did. */
  avgPlacement: number | null;
  /** The final board's dominant tribe seen most often across runs; null when no run recorded one. */
  favoriteTribe: Tribe | null;
}

/** The four left-column tiles + the portrait's hero, over every run handed in (newest first). Pure. */
export function careerAggregates(runs: readonly CareerRun[]): CareerAggregates {
  const heroCount = new Map<string, number>();
  const tribeCount = new Map<Tribe, number>();
  let placed = 0, firsts = 0, top4 = 0, placementSum = 0;
  for (const r of runs) {
    if (r.heroId) heroCount.set(r.heroId, (heroCount.get(r.heroId) ?? 0) + 1);
    if (r.dominantTribe) tribeCount.set(r.dominantTribe, (tribeCount.get(r.dominantTribe) ?? 0) + 1);
    if (r.placement !== null) {
      placed++;
      placementSum += r.placement;
      if (r.placement === 1) firsts++;
      if (r.placement <= 4) top4++;
    }
  }
  // Map insertion order is newest-first, so on a tie the FIRST max is the most recently played.
  let mostPlayedHero: string | null = null, best = 0;
  for (const [h, c] of heroCount) if (c > best) { best = c; mostPlayedHero = h; }
  let favoriteTribe: Tribe | null = null; best = 0;
  for (const [t, c] of tribeCount) if (c > best) { best = c; favoriteTribe = t; }
  return {
    runs: runs.length,
    mostPlayedHero,
    firsts,
    top4Pct: placed ? Math.round((top4 / placed) * 100) : null,
    avgPlacement: placed ? Math.round((placementSum / placed) * 10) / 10 : null,
    favoriteTribe,
  };
}

// ── Heroes tab (owner ask 2026-09-20) ───────────────────────────────────────────────────────────────────

/** One hero's career — every run the account played it, folded. Feeds the portrait grid + its hover panel. */
export interface HeroCareer {
  heroId: string;
  /** Games played on this hero (every run, placed or not). */
  runs: number;
  /** 1st-place finishes. */
  firsts: number;
  /** The MATCH record across the hero's runs — `isMatchWin`: top-4 finishes are wins, 5th–8th losses; a run
   *  with no placement counts in neither. */
  wins: number;
  losses: number;
  /** wins ÷ (wins + losses) as a whole percent; null when no run recorded a placement. */
  winRate: number | null;
  /** Mean placement to one decimal over the runs that recorded one; null when none did. */
  avgPlacement: number | null;
  /** Best (lowest) placement; null when no run recorded one. */
  bestPlacement: number | null;
  /** When the hero was last played (max run end time); NaN when no run carries a time. */
  lastAtMs: number;
}

/** Every hero the account has played, folded over ALL the runs handed in, sorted by games played (desc), then
 *  match win rate (desc, unknown last), then hero id — heroes never played are simply absent. Pure. */
export function heroCareers(runs: readonly CareerRun[]): HeroCareer[] {
  const by = new Map<string, HeroCareer & { placementSum: number }>();
  for (const r of runs) {
    if (!r.heroId) continue;
    let h = by.get(r.heroId);
    if (!h) {
      h = { heroId: r.heroId, runs: 0, firsts: 0, wins: 0, losses: 0, winRate: null, avgPlacement: null, bestPlacement: null, lastAtMs: NaN, placementSum: 0 };
      by.set(r.heroId, h);
    }
    h.runs++;
    const won = isMatchWin(r.placement);
    if (won !== null) {
      if (won) h.wins++; else h.losses++;
    }
    if (r.placement !== null) {
      h.placementSum += r.placement;
      if (r.placement === 1) h.firsts++;
      if (h.bestPlacement === null || r.placement < h.bestPlacement) h.bestPlacement = r.placement;
    }
    if (Number.isFinite(r.atMs) && !(h.lastAtMs >= r.atMs)) h.lastAtMs = r.atMs;
  }
  const out: HeroCareer[] = [...by.values()].map(({ placementSum, ...h }) => {
    const placed = h.wins + h.losses;
    return {
      ...h,
      winRate: placed > 0 ? Math.round((h.wins / placed) * 100) : null,
      avgPlacement: placed ? Math.round((placementSum / placed) * 10) / 10 : null,
    };
  });
  out.sort((a, b) => b.runs - a.runs || (b.winRate ?? -1) - (a.winRate ?? -1) || a.heroId.localeCompare(b.heroId));
  return out;
}

// ── Performance trends ──────────────────────────────────────────────────────────────────────────────────

export type TrendWindow = 7 | 30 | 90;
export const TREND_WINDOWS: readonly TrendWindow[] = [7, 30, 90];

export interface TrendPoint { atMs: number; y: number }
export interface TrendSeries {
  /** One point per run in the window that has the value, oldest first. */
  points: TrendPoint[];
  /** The headline: the mean of `points[].y` to one decimal (placement, APM) — or, for `winRate`, the window's
   *  OVERALL match win rate as a whole percent. Null with no points. */
  avg: number | null;
}
export interface TrendSet {
  /** y = the run's lobby placement (1 best). */
  placement: TrendSeries;
  /** The MATCH win rate (owner 2026-09-20): a match is won by placement (`isMatchWin` — top 4 = W, 5th–8th =
   *  L), and the headline `avg` is the window's overall win rate — the share of placed runs that finished
   *  top 4, whole percent. Each point's y is the RUNNING win rate through the window (wins so far ÷ placed
   *  runs so far, oldest first), so the line shows how that share moved and ends on the headline number; a
   *  per-run 0/100 series would only zig-zag. Runs with no placement contribute no point. */
  winRate: TrendSeries;
  /** y = actions per minute — `apmOf` (needs the entry's APT AND a telemetry clock); runs without are skipped. */
  apm: TrendSeries;
}

const seriesOf = (points: TrendPoint[]): TrendSeries => ({
  points,
  avg: points.length ? Math.round((points.reduce((s, p) => s + p.y, 0) / points.length) * 10) / 10 : null,
});

/** The three trend series over the runs that ended within the last `days` days of `nowMs`, oldest first. A
 *  run with no usable end time is outside every window. Pure. */
export function trendSeries(runs: readonly CareerRun[], days: TrendWindow, nowMs: number): TrendSet {
  const since = nowMs - days * 86_400_000;
  const inWindow = runs
    .filter((r) => Number.isFinite(r.atMs) && r.atMs >= since && r.atMs <= nowMs + 60_000)
    .slice()
    .sort((a, b) => a.atMs - b.atMs);
  const placement: TrendPoint[] = [];
  const winRate: TrendPoint[] = [];
  const apm: TrendPoint[] = [];
  let matchWins = 0, matchesPlaced = 0;
  for (const r of inWindow) {
    if (r.placement !== null) placement.push({ atMs: r.atMs, y: r.placement });
    const won = isMatchWin(r.placement);
    if (won !== null) {
      matchesPlaced++;
      if (won) matchWins++;
      winRate.push({ atMs: r.atMs, y: Math.round((matchWins / matchesPlaced) * 100) });
    }
    const a = apmOf(r);
    if (a !== null) apm.push({ atMs: r.atMs, y: a });
  }
  return {
    placement: seriesOf(placement),
    winRate: { points: winRate, avg: matchesPlaced ? Math.round((matchWins / matchesPlaced) * 100) : null },
    apm: seriesOf(apm),
  };
}

/** Points → an SVG polyline `points` attribute inside a `w`×`h` box with `pad` px of margin. `yMin`/`yMax`
 *  fix the axis; `invert` puts yMin at the TOP (placement: 1st reads high). One point renders as a dot's
 *  worth of line (x centred). Pure; the chart component only prints the string. */
export function polylineOf(points: readonly TrendPoint[], box: { w: number; h: number; pad: number; yMin: number; yMax: number; invert?: boolean }): string {
  const { w, h, pad, yMin, yMax, invert } = box;
  const n = points.length;
  if (n === 0) return '';
  const span = Math.max(1e-9, yMax - yMin);
  const innerW = w - pad * 2, innerH = h - pad * 2;
  return points.map((p, i) => {
    const x = n === 1 ? w / 2 : pad + (i / (n - 1)) * innerW;
    const t = Math.min(1, Math.max(0, (p.y - yMin) / span));
    const y = invert ? pad + t * innerH : pad + (1 - t) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}
