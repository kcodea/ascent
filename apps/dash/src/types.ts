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
