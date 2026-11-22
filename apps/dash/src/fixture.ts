// MADE-UP data for local work on the page (`npm run dev -w apps/dash` serves it at /api/*; see vite.config.ts). It
// never ships: the production build has no /api route but the Pages Functions, which only ever read the database.
// Every number here is invented; the shapes are the real contract (src/types.ts).
import type { Breakdown, GameMode, HeroRow, Overview, OverviewDay, TribeRow } from './types';

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

const HEROES = ['warden', 'magician', 'coran', 'fi', 'disco_dan', 'yazzus', 'tamby', 'han_gover', 'enigma', 'runesmith', 'guardian', 'lifebinder'];
const TRIBES = ['beast', 'mech', 'undead', 'dragon', 'kobold', 'spirit', 'dwarf', 'celestial', 'elemental'];
const MEDALS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
const MODES: GameMode[] = ['ranked', 'unrated_lobby', 'practice', 'versus_duel', 'versus_group', 'versus_duos', 'ranked_duos', 'tutorial'];
const SEATS: Record<GameMode, number> = { ranked: 8, unrated_lobby: 8, practice: 8, versus_duel: 2, versus_group: 4, versus_duos: 4, ranked_duos: 4, tutorial: 8, other: 8 };

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export function fixtureOverview(today = new Date()): Overview {
  const r = rng(7);
  const daily: OverviewDay[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const growth = 1 + (29 - i) / 40;
    const byMode: OverviewDay['byMode'] = {
      ranked: Math.round((14 + r() * 10) * growth),
      unrated_lobby: Math.round(r() * 3),
      practice: Math.round((5 + r() * 6) * growth),
      versus_duel: Math.round(r() * 4),
      versus_group: Math.round(r() * 2),
      versus_duos: Math.round(r() * 2),
      ranked_duos: Math.round(r() * 3),
      tutorial: Math.round(r() * 2),
    };
    const games = Object.values(byMode).reduce((a, b) => a + (b ?? 0), 0);
    daily.push({
      day: iso(d),
      games,
      accounts: Math.max(1, Math.round(games / (2.6 + r()))),
      newEmail: Math.round(r() * 1.4),
      newGuest: Math.round(2 + r() * 9),
      firstGame: Math.round(r() * 4),
      byMode,
    });
  }
  const sum = (n: number, k: 'games' | 'accounts') => daily.slice(-n).reduce((a, d) => a + d[k], 0);
  return {
    tz: 'UTC',
    today: daily[daily.length - 1]!.day,
    days: 30,
    daily,
    windows: {
      d1: { games: sum(1, 'games'), accounts: sum(1, 'accounts') },
      d7: { games: sum(7, 'games'), accounts: Math.round(sum(7, 'accounts') / 3.1) },
      d30: { games: sum(30, 'games'), accounts: Math.round(sum(30, 'accounts') / 6.5) },
    },
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

export function fixtureBreakdown(params: { from?: string | null; to?: string | null; patch?: string | null } = {}): Breakdown {
  const r = rng(11 + (params.patch ? params.patch.length : 0));
  const to = params.to ?? iso(new Date());
  const from = params.from ?? iso(new Date(Date.parse(to) - 6 * 86_400_000));
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
    for (const heroId of HEROES.slice(0, 9)) {
      const games = Math.round((total / 9) * (0.3 + r() * 1.4));
      if (games <= 0) continue;
      heroes.push({ mode: 'ranked', band, heroId, games, pickRate: Math.round((games / total) * 10000) / 10000, ...rates(r, 8, games) });
    }
  }
  const tribe = (mode: GameMode, scale: number, k: number): TribeRow[] =>
    TRIBES.slice(0, k).map((t) => {
      const games = Math.round(scale * (0.3 + r() * 0.7));
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
    tribesInRun: [...tribe('ranked', 180, 9), ...tribe('unrated_lobby', 12, 9), ...tribe('practice', 70, 9)],
    tribesFinal: [...tribe('ranked', 120, 8), ...tribe('unrated_lobby', 8, 6)],
  };
}
