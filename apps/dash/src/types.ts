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

export interface OverviewDay {
  day: string; // yyyy-mm-dd in the viewer's time zone
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
  days: number;
  daily: OverviewDay[];
  windows: Record<'d1' | 'd7' | 'd30', { games: number; accounts: number }>;
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
