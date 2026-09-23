/**
 * LOBBY STRENGTH — how hard the seven opponents at a table were, as one number (owner 2026-09-22: "make an
 * algorithm that can essentially assign a lobby strength value/indicator … we can then make winning really
 * difficult lobbies more rewarding"; the owner's answer (3): "we want to use raw data on win rate across all
 * rounds served for the board. rank is not important right now as a factor").
 *
 * THE FORMULA, in one sentence: the average win rate of your seven opponents' runs, as a percentage, where a
 * run nobody has data on counts as 50 and a generated seat (a bot) as 25.
 *
 * Per opponent seat the win rate is SMOOTHED with a Bayesian prior of 10 wins in 20 fights:
 *     smoothed = (wins + 10) / (fights + 20)
 * so an unserved run sits at exactly 0.5, a run that is 2-0 reads 0.545 rather than 1.0, and a proven 70%
 * run over 200 fights reads 0.691. A bot key (`bot:<kind>:<hero>`, see `fightLedger.ts`) is a fixed 0.25.
 * The strength is `round(100 × mean)` over the seven — no further rescale: the prior already puts a table with
 * no information at exactly 50, a table of bots at 25 and a table of proven 70% runs near 70, and the number
 * is monotonic in every opponent's record by construction. (A rescale toward "the field's typical lobby reads
 * 50" would be the identity while the field is young; revisit once the view has data — never tune it to force
 * Hard/Brutal reads.)
 *
 * The SERVER recomputes the same number from the same view at settle time (`settle_rank`, mirrored in
 * `supabase/functions/_shared/lobbyRating.ts`); this copy is what the client shows before the settle and what
 * the tests pin. All three must agree — the parity test drives the same inputs through the two TS copies and
 * reads the constants out of the SQL.
 */

/** The prior: 10 wins in 20 fights (an unserved run reads 50). */
export const STRENGTH_PRIOR_WINS = 10;
export const STRENGTH_PRIOR_FIGHTS = 20;
/** A generated seat's fixed win rate. */
export const STRENGTH_BOT_RATE = 0.25;

export type LobbyStrengthTier = 'Easy' | 'Even' | 'Hard' | 'Brutal';

/** The tier cuts, in ONE place (a starting cut, owner 2026-09-22): Easy below 35, Even 35 to 54, Hard 55 to
 *  69, Brutal 70 and up. */
export const STRENGTH_TIERS: { readonly even: number; readonly hard: number; readonly brutal: number } = Object.freeze({ even: 35, hard: 55, brutal: 70 });

/** THE BONUS (owner answer (6): "only winning hard lobbies should scale, and only upwards of 15 rating"): a
 *  1st-place finish in a lobby of strength `s` adds `round(15 × clamp((s − 55) / 45, 0, 1))` rating points on
 *  top of the normal award — 0 at Hard's floor (55), +15 at 100, nothing below 55, never on 2nd to 8th, never
 *  negative. */
export const STRENGTH_BONUS_MAX = 15;
export const STRENGTH_BONUS_FLOOR = 55;
export const STRENGTH_BONUS_SPAN = 100 - STRENGTH_BONUS_FLOOR;

/** One opponent's record as the view reports it. A key with no row is passed with 0 fights. */
export interface StrengthInput {
  key: string;
  fights: number;
  wins: number;
}

export interface LobbyStrength {
  /** 0 to 100. */
  value: number;
  tier: LobbyStrengthTier;
  /** The seven opponents' records the value was computed from, so the number can be re-derived later. */
  inputs: StrengthInput[];
}

/** The smoothed win rate of one seat: a bot is a fixed 0.25; anything else is `(wins + 10) / (fights + 20)`. */
export function seatStrengthRate(input: StrengthInput): number {
  if (input.key.startsWith('bot:')) return STRENGTH_BOT_RATE;
  const fights = Math.max(0, input.fights);
  const wins = Math.min(fights, Math.max(0, input.wins));
  return (wins + STRENGTH_PRIOR_WINS) / (fights + STRENGTH_PRIOR_FIGHTS);
}

export function strengthTierOf(value: number): LobbyStrengthTier {
  if (value >= STRENGTH_TIERS.brutal) return 'Brutal';
  if (value >= STRENGTH_TIERS.hard) return 'Hard';
  if (value >= STRENGTH_TIERS.even) return 'Even';
  return 'Easy';
}

/** The lobby's strength from its opponents' records. An empty input list (no opponents known) reads 50 / Even. */
export function lobbyStrengthOf(inputs: readonly StrengthInput[]): LobbyStrength {
  const list = inputs.map((i) => ({ key: i.key, fights: i.fights, wins: i.wins }));
  const mean = list.length === 0 ? 0.5 : list.reduce((sum, i) => sum + seatStrengthRate(i), 0) / list.length;
  const value = Math.max(0, Math.min(100, Math.round(100 * mean)));
  return { value, tier: strengthTierOf(value), inputs: list };
}

/** The rating bonus a 1st-place finish earns at strength `value` (0 for any other placement or a null strength). */
export function strengthBonusOf(value: number | null | undefined, placement: number): number {
  if (placement !== 1 || value == null || !Number.isFinite(value)) return 0;
  const t = Math.max(0, Math.min(1, (value - STRENGTH_BONUS_FLOOR) / STRENGTH_BONUS_SPAN));
  return Math.round(STRENGTH_BONUS_MAX * t);
}

/** "Brutal 74" — the one label the Career and Recent Games rows print. */
export function strengthText(s: Pick<LobbyStrength, 'value' | 'tier'>): string {
  return `${s.tier} ${s.value}`;
}

/** Parse a stored strength stamp (a history entry / a replay result) — null for anything malformed. */
export function parseLobbyStrength(x: unknown): LobbyStrength | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const value = typeof o.value === 'number' ? o.value : typeof o.value === 'string' ? Number(o.value) : NaN;
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  const tier = strengthTierOf(value);
  const inputs = Array.isArray(o.inputs)
    ? (o.inputs as unknown[]).flatMap((i) => {
        const r = i as Record<string, unknown> | null;
        return r && typeof r.key === 'string' && typeof r.fights === 'number' && typeof r.wins === 'number'
          ? [{ key: r.key, fights: r.fights, wins: r.wins }] : [];
      })
    : [];
  return { value: Math.round(value), tier, inputs };
}
