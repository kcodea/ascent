// MADE-UP data for the round-two sections (players, social, progression, health), for local work only: the dev /
// preview server answers /api/<section> with these (vite.config.ts). Every number is invented; the shapes are the real
// contract (src/types.ts, supabase/migrations/2026-11-29-analytics-v2.sql). Ids come from the synced game data.
import { fixtureOverview } from './fixture';
import type { HealthData, PlayersData, ProgressionData, SocialData, TrendItem } from './types';

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
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

export interface Fixture2Ids { heroes: string[]; tribes: string[]; runes: string[]; ancients: string[]; achievements: string[]; cosmetics: string[]; titles: string[] }
const FALLBACK: Fixture2Ids = {
  heroes: ['warden', 'indy', 'myra', 'soren', 'nadja', 'keshi'], tribes: ['kobold', 'dragon', 'beast', 'demon', 'dwarf'],
  runes: ['r1', 'r2', 'r3'], ancients: ['death', 'fortune', 'war', 'genesis', 'time', 'bonds'], achievements: ['a1', 'a2'], cosmetics: ['c1'], titles: ['t1'],
};
type Range = { from?: string | null; to?: string | null };

export function fixturePlayers(p: Range = {}, now = new Date()): PlayersData {
  const o = fixtureOverview(p, now);
  const r = rng(31);
  const cohort = Math.max(3, o.totals.firstGame);
  const ratio = (e: number, k: number) => ({ eligible: e, returned: Math.round(e * k) });
  const weeks = new Map<string, number>();
  for (const s of o.series) { const d = new Date(`${s.t.slice(0, 10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); const k = d.toISOString().slice(0, 10); weeks.set(k, (weeks.get(k) ?? 0) + s.firstGame); }
  const heat: PlayersData['heatmap'] = [];
  for (let dow = 1; dow <= 7; dow++) for (let h = 0; h < 24; h++) {
    const evening = h >= 17 && h <= 23 ? 2.2 : h >= 9 && h < 17 ? 1 : 0.25;
    const weekend = dow >= 6 ? 1.5 : 1;
    const g = Math.round(evening * weekend * (2 + r() * 6));
    if (g > 0) heat.push({ dow, hour: h, games: g });
  }
  const mau = Math.max(8, Math.round(o.totals.accounts * 1.3));
  return {
    tz: 'UTC', from: o.from, to: o.to,
    retention: { cohort, d1: ratio(Math.round(cohort * 0.9), 0.38), d7: ratio(Math.round(cohort * 0.75), 0.24), d30: ratio(Math.round(cohort * 0.4), 0.12) },
    cohorts: [...weeks.entries()].reverse().slice(0, 10).map(([week, n], i) => {
      const players = Math.max(1, n);
      const e = (k: number) => (i * 7 >= k ? players : 0);
      return { week, players, d1: Math.round(e(1) * 0.4), d1Eligible: e(1), d7: Math.round(e(7) * 0.25), d7Eligible: e(7), d30: Math.round(e(30) * 0.12), d30Eligible: e(30) };
    }),
    active: { dau: Math.round(mau * 0.28), wau: Math.round(mau * 0.62), mau, dauAvg30: round(mau * 0.25, 2), stickiness: 0.25 },
    gamesPerPlayer: { players: o.totals.accounts, mean: 6.4, median: 3, buckets: [['1', 0.31], ['2-3', 0.24], ['4-7', 0.19], ['8-15', 0.14], ['16-31', 0.08], ['32+', 0.04]].map(([label, k]) => ({ label: label as string, players: Math.round(o.totals.accounts * (k as number)) })) },
    playTime: { hours: round(o.totals.games * 0.31, 1), timedGames: Math.round(o.totals.games * 0.92), games: o.totals.games, avgMinutes: 18.6 },
    heatmap: heat,
  };
}

export function fixtureSocial(p: Range = {}, now = new Date()): SocialData {
  const o = fixtureOverview(p, now);
  const r = rng(47);
  const series = o.series.map((s) => ({ t: s.t, counts: {
    versus_duel: s.byMode.versus_duel ?? 0, versus_group: s.byMode.versus_group ?? 0, versus_duos: s.byMode.versus_duos ?? 0, ranked_duos: s.byMode.ranked_duos ?? 0,
    duos_team: Math.round(r() * 1.2), friend_request: Math.round(r() * 3), friend_accept: Math.round(r() * 2), invite_versus: Math.round(r() * 4), invite_duos: Math.round(r() * 2),
    dm: s.t.slice(0, 10) === now.toISOString().slice(0, 10) ? Math.round(5 + r() * 20) : 0,
  } }));
  const totals: SocialData['totals'] = {};
  for (const s of series) for (const [k, v] of Object.entries(s.counts)) totals[k as keyof typeof totals] = (totals[k as keyof typeof totals] ?? 0) + (v ?? 0);
  return {
    tz: 'UTC', from: o.from, to: o.to, bucket: o.bucket,
    now: { online: 14, inGame: 9, byMode: { lobby: 6, practice: 2, versus: 1 }, watching: 2, at: now.toISOString() },
    series, totals,
    invites: { sent: (totals.invite_versus ?? 0) + (totals.invite_duos ?? 0), accepted: Math.round(((totals.invite_versus ?? 0) + (totals.invite_duos ?? 0)) * 0.55) },
    friendships: { accepted: 61, pending: 7 },
    dmOldest: new Date(now.getTime() - 23 * 3_600_000).toISOString(),
  };
}

export function fixtureProgression(p: Range = {}, now = new Date(), ids: Fixture2Ids = FALLBACK): ProgressionData {
  const o = fixtureOverview(p, now);
  const r = rng(53);
  const medal = (d: number) => ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant'][Math.min(5, Math.floor(d / 3))]!;
  const shape = [6, 9, 12, 14, 15, 13, 12, 10, 8, 7, 5, 4, 3, 2, 2, 1, 1, 1];
  const series = o.series.map((s) => { const games = Math.round((s.byMode.ranked ?? 0) * 0.9); return { t: s.t, games, net: Math.round(games * (r() * 6 - 1)), promotions: Math.round(games * 0.06), demotions: Math.round(games * 0.03) }; });
  const games = series.reduce((a, s) => a + s.games, 0);
  return {
    tz: 'UTC', from: o.from, to: o.to, bucket: o.bucket, season: 3,
    divisions: shape.map((n, division) => ({ division, medal: medal(division), players: n })),
    movement: { games, players: Math.round(games / 4), netPoints: series.reduce((a, s) => a + s.net, 0), avgDelta: 2.6, promotions: series.reduce((a, s) => a + s.promotions, 0), demotions: series.reduce((a, s) => a + s.demotions, 0),
      byMedal: ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant'].map((m, i) => ({ medal: m, games: Math.round(games * [0.2, 0.3, 0.25, 0.15, 0.07, 0.03][i]!), avgDelta: round(9 - i * 3.1, 2) })),
      series },
    levels: { players: 96, max: 41, median: 7, buckets: [['1', 12], ['2-4', 24], ['5-9', 27], ['10-19', 21], ['20-49', 11], ['50+', 1]].map(([label, n]) => ({ label: label as string, players: n as number })) },
    achievements: { inRange: o.series.length * 7, players: 88, series: o.series.map((s) => ({ t: s.t, n: Math.round(3 + r() * 9) })),
      most: ids.achievements.slice(0, 8).map((id, i) => ({ id, players: 80 - i * 7 })), least: ids.achievements.slice(-8).map((id, i) => ({ id, players: i })) },
    equipped: ids.cosmetics.slice(0, 10).map((id, i) => ({ id, category: null, players: 30 - i * 2 })),
    titles: ids.titles.slice(0, 6).map((id, i) => ({ id, players: 22 - i * 3 })),
  };
}

export function fixtureHealth(p: Range = {}, now = new Date(), ids: Fixture2Ids = FALLBACK): HealthData {
  const o = fixtureOverview(p, now);
  const r = rng(61);
  const span = Math.round((Date.parse(o.to) - Date.parse(o.from)) / 86_400_000) + 1;
  const trendBucket = span > 120 ? 'month' : 'week';
  const points: string[] = [];
  for (let d = new Date(`${o.from}T00:00:00Z`); d <= new Date(`${o.to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const k = trendBucket === 'month' ? `${d.toISOString().slice(0, 8)}01` : (() => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); })();
    if (!points.includes(k)) points.push(k);
  }
  const trend = (list: string[], scale: number): TrendItem[] => list.map((id, i) => {
    const base = 3.2 + r() * 2.4;
    const series = points.map((t) => { const avg = round(Math.max(1, Math.min(8, base + (r() - 0.5) * 1.2)), 2); return { t, games: Math.round(scale * (0.4 + r())), avgPlacement: avg, top4Rate: round(Math.max(0, Math.min(1, 1 - (avg - 1) / 7 + (r() - 0.5) * 0.1))) }; });
    return { id, games: series.reduce((a, s) => a + s.games, 0) + (list.length - i) * 3, avgPlacement: round(base, 2), top4Rate: round(1 - (base - 1) / 7), series };
  }).sort((a, b) => b.games - a.games);
  const cs = o.series.map((s) => ({ t: s.t, crashes: r() < 0.3 ? Math.round(r() * 3) : 0, bugs: r() < 0.2 ? 1 : 0 }));
  return {
    tz: 'UTC', from: o.from, to: o.to, bucket: o.bucket, trendBucket,
    crashes: { total: cs.reduce((a, c) => a + c.crashes, 0), series: cs, byBuild: [{ build: '0.1.0+98f2762', n: 4 }, { build: '0.1.0+25b9fa7', n: 2 }], byStep: [{ step: 'boot', n: 3 }, { step: 'combat', n: 2 }, { step: 'shop', n: 1 }] },
    bugs: { total: cs.reduce((a, c) => a + c.bugs, 0), byStatus: { open: 3, triaged: 2, fixed: 5 }, bySeverity: { high: 1, medium: 4, low: 5 } },
    ops: {
      status: { last_cron_at: new Date(now.getTime() - 7 * 3_600_000).toISOString(), cron_overdue: false, cron_failing: false, failing_checks: [], last_cli_at: null },
      latest: ['pool digest', 'hub up', 'writes arriving', 'session flush', 'writer keys'].map((check, i) => ({ check, status: i === 3 ? 'n/a' : 'ok', source: 'cron', ts: new Date(now.getTime() - 7 * 3_600_000).toISOString(), detail: '' })),
      retentionRules: [['perf_runs', 60, 12, 240], ['versus_1v1_leftovers', 30, 0, 1810], ['versus_group_leftovers', 30, 41, 5320], ['anon_empty_users', 30, 23, 2190]].map(([rule, keepDays, lastDeleted, totalDeleted]) => ({ rule: rule as string, enabled: true, keepDays: keepDays as number, lastCheckedAt: new Date(now.getTime() - 10 * 3_600_000).toISOString(), lastDryRun: false, lastCandidates: lastDeleted as number, lastDeleted: lastDeleted as number, lastError: null, totalDeleted: totalDeleted as number })),
      retentionRuns: Array.from({ length: 5 }, (_, i) => ({ at: new Date(now.getTime() - (10 + 24 * i) * 3_600_000).toISOString(), kind: 'run', deleted: Math.round(40 + r() * 80), failed: 0 })),
    },
    database: { bytes: 171 * 1048576, limitBytes: 524288000, tables: [['public.run_telemetry', 61], ['public.boards', 21], ['public.practice_games', 14], ['public.lobby_fights', 9], ['public.run_history', 6], ['public.versus_group_fights', 4], ['auth.users', 3], ['public.achievement_progress', 2]].map(([table, mb]) => ({ table: table as string, bytes: (mb as number) * 1048576 })) },
    trends: { hero: trend(ids.heroes.slice(0, 10), 6), tribe: trend(ids.tribes, 12), rune: trend(ids.runes.slice(0, 12), 2), ancient: trend(ids.ancients, 4) },
  };
}
