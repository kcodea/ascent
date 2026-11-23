// The JSON the two analytics RPCs return (supabase/migrations/2026-11-27-analytics-dashboard.sql). The Pages Function
// passes it through unchanged, so this file is the page's contract with that SQL. Numbers that Postgres returns as
// `numeric` arrive as JSON numbers; averages and rates are null when nothing had a placement.

export type GameMode =
  | 'ranked'
  | 'unrated_lobby'
  | 'practice'
  | 'versus_duel'
  | 'versus_group'
  | 'versus_duos'
  | 'ranked_duos'
  | 'tutorial'
  | 'other';

export type Bucket = 'hour' | 'day' | 'week' | 'month';

/** One bucket of the series. `t` is its start in the viewer's time zone, `yyyy-mm-ddTHH:MM`. */
export interface SeriesPoint {
  t: string;
  games: number;
  accounts: number;
  newEmail: number;
  newGuest: number;
  firstGame: number;
  byMode: Partial<Record<GameMode, number>>;
}

export interface Overview {
  tz: string;
  today: string;
  from: string; // the range actually used (all time starts at the first finished game)
  to: string;
  bucket: Bucket; // hour for one day, day up to 92 days, week up to two years, then month
  series: SeriesPoint[];
  totals: { games: number; accounts: number; newEmail: number; newGuest: number; firstGame: number };
  previous: { games: number; accounts: number } | null; // the same length just before; null for all time
}

export interface PatchRow { patch: string; games: number; firstSeen: string; lastSeen: string }
export interface ModeRow { mode: GameMode; games: number; accounts: number; seats: number; avgPlacement: number | null }
export interface HeroRow {
  mode: GameMode;
  band: string; // 'all', or a medal name for ranked
  heroId: string;
  games: number;
  pickRate: number | null;
  avgPlacement: number | null;
  topHalfRate: number | null;
  firstRate: number | null;
}
export interface HeroOfferRow { heroId: string; offered: number; picked: number; offerPickRate: number | null }
export interface MedalRow { medal: string; games: number; avgPlacement: number | null }
export interface TribeRow {
  mode: GameMode;
  tribe: string;
  games: number;
  rate: number | null;
  avgPlacement: number | null;
  top4Rate: number | null;
  firstRate: number | null;
}

/** public/game-data.json, written at build time by scripts/sync-game.mts from the game's own data and art. */
export interface GameData {
  setId: string;
  activeTribes: string[];
  activeHeroes: string[];
  heroes: Record<string, { name: string; art: string | null; archived: boolean }>;
  tribes: Record<string, { name: string; color: string | null; icon: string }>;
  medals: Record<string, string>;
  modes: Record<string, string>;
  chrome: Record<string, string>;
  medallions?: Record<string, string>;
  divisions?: string[]; // index -> "Gold 2" (divisionName in @game/progression)
}

/** public/game-names.json: the long name lists only the round-two sections print (fetched on first use). */
export interface GameNames {
  runes: Record<string, { name: string; art: string | null }>;
  ancients: Record<string, { name: string; art: string | null }>;
  achievements: Record<string, string>;
  cosmetics: Record<string, { name: string; category: string }>;
  titles: Record<string, string>;
  cards?: Record<string, { name: string; tier: number; tribe: string; tribe2?: string; spell: boolean; art: string | null }>;
  setCards?: Record<string, string[]>;
  sets?: Record<string, { name: string; enabled: boolean }>;
}

// ── Round two (supabase/migrations/2026-11-29-analytics-v2.sql) ─────────────────────────────────────────────
export interface Ratio { eligible: number; returned: number }
export interface PlayersData {
  tz: string; from: string; to: string;
  retention: { cohort: number; d1: Ratio; d7: Ratio; d30: Ratio };
  cohorts: Array<{ week: string; players: number; d1: number; d1Eligible: number; d7: number; d7Eligible: number; d30: number; d30Eligible: number }>;
  active: { dau: number; wau: number; mau: number; dauAvg30: number | null; stickiness: number | null };
  gamesPerPlayer: { players: number; mean: number | null; median: number | null; buckets: Array<{ label: string; players: number }> };
  playTime: { hours: number; timedGames: number; games: number; avgMinutes: number | null };
  heatmap: Array<{ dow: number; hour: number; games: number }>; // dow 1 = Monday .. 7 = Sunday
}

export type SocialKind = 'versus_duel' | 'versus_group' | 'versus_duos' | 'ranked_duos' | 'duos_team' | 'friend_request' | 'friend_accept' | 'invite_versus' | 'invite_duos' | 'dm';
export interface SocialData {
  tz: string; from: string; to: string; bucket: Bucket;
  now: { online: number; inGame: number; byMode: Record<string, number>; watching: number; at: string };
  series: Array<{ t: string; counts: Partial<Record<SocialKind, number>> }>;
  totals: Partial<Record<SocialKind, number>>;
  invites: { sent: number; accepted: number };
  friendships: { accepted: number; pending: number };
  dmOldest: string | null;
}

export interface ProgressionData {
  tz: string; from: string; to: string; bucket: Bucket; season: number | null;
  divisions: Array<{ division: number; medal: string; players: number }>;
  movement: {
    games: number; players: number; netPoints: number; avgDelta: number | null; promotions: number; demotions: number;
    byMedal: Array<{ medal: string; games: number; avgDelta: number }>;
    series: Array<{ t: string; games: number; net: number; promotions: number; demotions: number }>;
  };
  levels: { players: number; max: number | null; median: number | null; buckets: Array<{ label: string; players: number }> };
  achievements: { inRange: number; players: number; series: Array<{ t: string; n: number }>; most: Array<{ id: string; players: number }>; least: Array<{ id: string; players: number }> };
  equipped: Array<{ id: string; category: string | null; players: number }>;
  titles: Array<{ id: string; players: number }>;
}

export interface TrendItem { id: string; games: number; avgPlacement: number; top4Rate: number; series: Array<{ t: string; games: number; avgPlacement: number; top4Rate: number }> }
export interface HealthData {
  tz: string; from: string; to: string; bucket: Bucket;
  crashes: { total: number; series: Array<{ t: string; crashes: number; bugs: number }>; byBuild: Array<{ build: string; n: number }>; byStep: Array<{ step: string; n: number }> };
  bugs: { total: number; byStatus: Record<string, number>; bySeverity: Record<string, number> };
  ops: {
    status: { last_cron_at?: string | null; cron_overdue?: boolean; cron_failing?: boolean; failing_checks?: string[] | string | null; last_cli_at?: string | null } | null;
    latest: Array<{ check: string; status: string; source: string; ts: string; detail: string }>;
    retentionRules: Array<{ rule: string; enabled: boolean; keepDays: number; lastCheckedAt: string | null; lastDryRun: boolean | null; lastCandidates: number | null; lastDeleted: number | null; lastError: string | null; totalDeleted: number }> | null;
    retentionRuns: Array<{ at: string; kind: string; deleted: number | null; failed: number | null }> | null;
  };
  database: { bytes: number; limitBytes: number; tables: Array<{ table: string; bytes: number }> };
}

/** One card or rune, compact (see analytics.balance): [id, seen, taken, takenPlayers, takenAvg, takenVar, takenTop4,
 *  passed, passedPlayers, passedAvg, passedVar, finalN, finalAvg, finalGolden, series [[bucket, n, avg]] | null]. */
export type BalanceRow = [string, number, number, number, number | null, number | null, number | null, number, number, number | null, number | null, number, number | null, number, Array<[string, number, number]> | null];

/** analytics_balance: the dev balance view, its own call so Health never pays for these scans. */
export interface BalanceData {
  tz: string; from: string; to: string; trendBucket: 'week' | 'month'; mode: 'ranked' | 'unrated' | 'all'; set: string | null;
  games: number; // Career rows (heroes, tribes, Ancients, final boards)
  rolledThrough?: string | null; // cards + runes: the last UTC day rolled up (null = none yet; today is always live)
  rolledFrom?: string | null; // the first UTC day rolled up
  runs: number; // telemetry runs (cards, runes)
  field: { n: number; avg: number | null; var: number | null; top4: number | null };
  trends: Partial<Record<'hero' | 'tribe' | 'ancient', TrendItem[]>>;
  items: Partial<Record<'card' | 'rune', BalanceRow[]>>;
}

export interface Breakdown {
  from: string;
  to: string;
  tz: string;
  patch: string | null;
  patches: PatchRow[];
  modes: ModeRow[];
  heroes: HeroRow[];
  heroOffers: HeroOfferRow[];
  medals: MedalRow[];
  tribesInRun: TribeRow[];
  tribesFinal: TribeRow[];
}
