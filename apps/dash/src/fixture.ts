// MADE-UP data for local work on the page (`npm run dev -w apps/dash` serves it at /api/*; see vite.config.ts). It
// never ships: the production build has no /api route but the Pages Functions, which only ever read the database.
// Every number here is invented; the shapes are the real contract (src/types.ts).
import type { Breakdown, Bucket, GameMode, HeroRow, Overview, SeriesPoint, TribeRow } from './types';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ids the fixture uses. The dev server passes the ACTIVE set's real heroes and tribes (public/game-data.json, written
 *  by scripts/sync-game.mts) so the preview looks like the real game; these are only the fallback. */
export interface FixtureIds { heroes: string[]; tribes: string[] }
const FALLBACK: FixtureIds = {
  heroes: ['warden', 'indy', 'myra', 'soren', 'nadja', 'keshi', 'aster', 'bram', 'cassen', 'albus', 'aevor', 'brackus'],
  tribes: ['kobold', 'dragon', 'beast', 'demon', 'dwarf'],
};
const MEDALS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant'];
const MODES: GameMode[] = ['ranked', 'unrated_lobby', 'practice', 'versus_duel', 'versus_group', 'versus_duos', 'ranked_duos', 'tutorial'];
const SEATS: Record<GameMode, number> = { ranked: 8, unrated_lobby: 8, practice: 8, versus_duel: 2, versus_group: 4, versus_duos: 4, ranked_duos: 4, tutorial: 8, other: 8 };

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number): string => iso(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const hash = (s: string): number => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

/** The fixture's pretend first game (so "All time" has a start). */
const FIXTURE_DAYS_OF_HISTORY = 400;

/** One made-up day, the same numbers every time it is asked for (so a day sums the same in every bucket size). */
function fixtureDay(day: string, today: string): SeriesPoint {
  const r = rng(hash(day));
  const age = daysBetween(day, today);
  const growth = 1 + Math.max(0, FIXTURE_DAYS_OF_HISTORY - age) / 160;
  const byMode: SeriesPoint['byMode'] = {
    ranked: Math.round((10 + r() * 10) * growth),
    unrated_lobby: Math.round(r() * 3),
    practice: Math.round((4 + r() * 6) * growth),
    versus_duel: Math.round(r() * 4),
    versus_group: Math.round(r() * 2),
    versus_duos: Math.round(r() * 2),
    ranked_duos: Math.round(r() * 3),
    tutorial: Math.round(r() * 2),
  };
  const games = Object.values(byMode).reduce((a, b) => a + (b ?? 0), 0);
  return { t: `${day}T00:00`, games, accounts: Math.max(1, Math.round(games / (2.6 + r()))), newEmail: Math.round(r() * 1.4), newGuest: Math.round(2 + r() * 9), firstGame: Math.round(r() * 4), byMode };
}

function addPoint(into: SeriesPoint, p: SeriesPoint, accountsShare = 1): void {
  into.games += p.games;
  into.accounts += Math.round(p.accounts * accountsShare);
  into.newEmail += p.newEmail;
  into.newGuest += p.newGuest;
  into.firstGame += p.firstGame;
  for (const [m, n] of Object.entries(p.byMode)) into.byMode[m as GameMode] = (into.byMode[m as GameMode] ?? 0) + (n ?? 0);
}
const emptyPoint = (t: string): SeriesPoint => ({ t, games: 0, accounts: 0, newEmail: 0, newGuest: 0, firstGame: 0, byMode: {} });

const bucketFor = (days: number): Bucket => (days <= 1 ? 'hour' : days <= 92 ? 'day' : days <= 731 ? 'week' : 'month');
function bucketStart(day: string, b: Bucket): string {
  if (b === 'month') return `${day.slice(0, 8)}01`;
  if (b === 'week') return addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7)); // Monday, like Postgres
  return day;
}

/** The overview for a range, shaped like `analytics_overview` (from null = all time, to null = today). */
export function fixtureOverview(params: { from?: string | null; to?: string | null } = {}, now = new Date()): Overview {
  const today = iso(now);
  const to = params.to && params.to < today ? params.to : today;
  let from = params.from ?? addDays(today, -FIXTURE_DAYS_OF_HISTORY);
  if (from > to) from = to;
  const span = daysBetween(from, to) + 1;
  const bucket = bucketFor(span);
  const sumRange = (a: string, b: string) => {
    const s = emptyPoint('');
    for (let d = a; d <= b; d = addDays(d, 1)) addPoint(s, fixtureDay(d, today), 0.45);
    return s;
  };
  let series: SeriesPoint[] = [];
  if (bucket === 'hour') {
    const day = fixtureDay(from, today);
    const lastHour = from === today ? now.getUTCHours() : 23;
    const weights = Array.from({ length: 24 }, (_, h) => 0.4 + Math.sin(((h - 9) / 24) * Math.PI * 2) * 0.35 + (h >= 17 && h <= 22 ? 0.5 : 0));
    const total = weights.reduce((a, b) => a + b, 0);
    const r = rng(hash(`${from}h`));
    for (let h = 0; h <= lastHour; h++) {
      const k = weights[h]! / total;
      const games = Math.round(day.games * k * (0.7 + r() * 0.6));
      const byMode: SeriesPoint['byMode'] = {};
      for (const [m, n] of Object.entries(day.byMode)) { const v = Math.round((n ?? 0) * k * (0.6 + r() * 0.8)); if (v > 0) byMode[m as GameMode] = v; }
      const g = Object.values(byMode).reduce((a, b) => a + (b ?? 0), 0);
      series.push({ t: `${from}T${String(h).padStart(2, '0')}:00`, games: g || games, accounts: Math.max(g ? 1 : 0, Math.round(g / 2.2)), newEmail: r() < 0.05 ? 1 : 0, newGuest: r() < 0.35 ? 1 : 0, firstGame: r() < 0.15 ? 1 : 0, byMode });
    }
  } else {
    const map = new Map<string, SeriesPoint>();
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const key = bucketStart(d, bucket);
      if (!map.has(key)) map.set(key, emptyPoint(`${key}T00:00`));
      addPoint(map.get(key)!, fixtureDay(d, today), bucket === 'day' ? 1 : 0.45);
    }
    series = [...map.values()];
  }
  const totals = series.reduce((s, p) => { addPoint(s, p); return s; }, emptyPoint(''));
  const distinct = span <= 1 ? Math.round(totals.accounts * 0.8) : Math.round(sumRange(from, to).accounts / Math.max(1, Math.sqrt(span) * 0.6));
  const prev = params.from ? sumRange(addDays(from, -span), addDays(from, -1)) : null;
  return {
    tz: 'UTC',
    today,
    from,
    to,
    bucket,
    series,
    totals: { games: totals.games, accounts: Math.max(1, distinct), newEmail: totals.newEmail, newGuest: totals.newGuest, firstGame: totals.firstGame },
    previous: prev ? { games: span <= 1 && from === today ? Math.round(prev.games * (now.getUTCHours() + 1) / 24) : prev.games, accounts: Math.max(1, Math.round(prev.accounts / Math.max(1, Math.sqrt(span) * 0.6))) } : null,
  };
}


function rates(r: () => number, seats: number, games: number) {
  const avg = 1 + r() * (seats - 1);
  return {
    avgPlacement: Math.round(avg * 100) / 100,
    topHalfRate: Math.round(Math.min(1, Math.max(0, 1 - (avg - 1) / (seats - 1) + (r() - 0.5) * 0.2)) * 10000) / 10000,
    firstRate: games > 0 ? Math.round(Math.min(1, (r() * 2) / seats) * 10000) / 10000 : null,
  };
}

export function fixtureBreakdown(params: { from?: string | null; to?: string | null; patch?: string | null } = {}, ids: FixtureIds = FALLBACK): Breakdown {
  const HEROES = ids.heroes.slice(0, 14);
  const TRIBES = ids.tribes;
  const r = rng(11 + (params.patch ? params.patch.length : 0));
  const to = params.to ?? iso(new Date());
  const from = params.from ?? addDays(to, -FIXTURE_DAYS_OF_HISTORY); // null = all time
  const heroes: HeroRow[] = [];
  const modes = MODES.map((mode) => {
    const total = mode === 'ranked' ? 180 : mode === 'practice' ? 70 : Math.round(8 + r() * 20);
    return { mode, total };
  });
  for (const { mode, total } of modes) {
    if (mode === 'tutorial') continue;
    let left = total;
    const pool = HEROES.slice(0, mode === 'ranked' || mode === 'practice' ? HEROES.length : 7);
    pool.forEach((heroId, i) => {
      const games = i === pool.length - 1 ? left : Math.min(left, Math.round((total / pool.length) * (0.4 + r() * 1.2)));
      left -= games;
      if (games <= 0) return;
      heroes.push({ mode, band: 'all', heroId, games, pickRate: Math.round((games / total) * 10000) / 10000, ...rates(r, SEATS[mode], games) });
    });
  }
  for (const band of MEDALS) {
    const total = Math.round(20 + r() * 40);
    for (const heroId of HEROES.slice(0, 10)) {
      const games = Math.round((total / 10) * (0.3 + r() * 1.4));
      if (games <= 0) continue;
      heroes.push({ mode: 'ranked', band, heroId, games, pickRate: Math.round((games / total) * 10000) / 10000, ...rates(r, 8, games) });
    }
  }
  // In run: a run draws 5 tribes from the set, so a set with exactly 5 has every tribe in every run.
  const tribe = (mode: GameMode, scale: number, k: number, inRun = false): TribeRow[] =>
    TRIBES.slice(0, k).map((t) => {
      const games = inRun ? Math.round(scale * Math.min(1, 5 / TRIBES.length) * (TRIBES.length <= 5 ? 1 : 0.8 + r() * 0.4)) : Math.round(scale * (0.08 + r() * 0.3));
      const avg = 3 + r() * 3;
      return { mode, tribe: t, games, rate: Math.round((games / scale) * 10000) / 10000, avgPlacement: Math.round(avg * 100) / 100, top4Rate: Math.round((0.75 - (avg - 3) / 6) * 10000) / 10000, firstRate: Math.round(r() * 0.25 * 10000) / 10000 };
    }).sort((a, b) => b.games - a.games);
  const patches = Array.from({ length: 8 }, (_, i) => {
    const seen = new Date(Date.parse(to) - i * 86_400_000 * 0.9);
    const sha = Math.floor(r() * 0xfffffff).toString(16).padStart(7, '0');
    return { patch: `0.1.0+${sha}`, games: Math.round(10 + r() * 60), firstSeen: seen.toISOString(), lastSeen: new Date(seen.getTime() + 20 * 3_600_000).toISOString() };
  });
  return {
    from,
    to,
    tz: 'UTC',
    patch: params.patch ?? null,
    patches,
    modes: modes.map(({ mode, total }) => ({ mode, games: total, accounts: Math.max(1, Math.round(total / (2 + r() * 3))), seats: SEATS[mode], avgPlacement: mode === 'tutorial' ? null : Math.round((1 + r() * (SEATS[mode] - 1)) * 100) / 100 })).sort((a, b) => b.games - a.games),
    heroes,
    heroOffers: HEROES.map((heroId) => {
      const offered = Math.round(30 + r() * 70);
      const picked = Math.round(offered * (0.15 + r() * 0.5));
      return { heroId, offered, picked, offerPickRate: Math.round((picked / offered) * 10000) / 10000 };
    }),
    medals: MEDALS.map((medal) => ({ medal, games: Math.round(15 + r() * 60), avgPlacement: Math.round((3.5 + r()) * 100) / 100 })),
    tribesInRun: [...tribe('ranked', 180, TRIBES.length, true), ...tribe('unrated_lobby', 12, TRIBES.length, true), ...tribe('practice', 70, TRIBES.length, true)],
    tribesFinal: [...tribe('ranked', 120, TRIBES.length), ...tribe('unrated_lobby', 8, TRIBES.length)],
  };
}
