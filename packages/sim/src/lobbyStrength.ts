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

/** THE BONUS (owner 2026-09-22, revised the same day: "the strength bonus applies to any TOP-4 finish, scaled
 *  by BOTH placement and lobby strength"): a top-4 finish in a lobby of strength `s` adds
 *
 *      bonus = round(15 × placementWeight × strengthFactor)
 *      placementWeight = 1.0 (1st) / 0.8 (2nd) / 0.62 (3rd) / 0.47 (4th)
 *      strengthFactor  = clamp((s − 30) / 70, 0, 1)        — 0 at strength 30 and below, 1 at 100
 *
 *  rating points on top of the normal award. The owner's anchors: 1st at 100 = +15, 1st at 75 = +10, 4th at 100
 *  = +7, 2nd at 100 = +12, 3rd at 100 = +9, 1st at 50 = +4, 4th at 50 = +2. Never on 5th to 8th, never
 *  negative, a loss is never scaled. The weights and the 30 / 70 line live HERE and nowhere else in this copy;
 *  `lobbyRating.ts` and `settle_rank` carry the same numbers (the parity test pins them). */
export const STRENGTH_BONUS_MAX = 15;
/** The strength the factor starts rising from (0 here and below). */
export const STRENGTH_BONUS_FLOOR = 30;
/** The strength span to the full factor: 1 at `STRENGTH_BONUS_FLOOR + STRENGTH_BONUS_SPAN` = 100. */
export const STRENGTH_BONUS_SPAN = 100 - STRENGTH_BONUS_FLOOR;
/** The placement weights, index 0 = 1st … 3 = 4th. 5th to 8th have no entry: no bonus. */
export const STRENGTH_PLACEMENT_WEIGHTS: readonly number[] = Object.freeze([1.0, 0.8, 0.62, 0.47]);
/** The worst placement that still earns a bonus (a top-4). */
export const STRENGTH_BONUS_WORST_PLACEMENT = STRENGTH_PLACEMENT_WEIGHTS.length;

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

/** THE FIELD GOING IN (owner 2026-09-22: "the lobby difficulty shows 47 in my career and 50 in recent games,
 *  why"): a lobby's strength describes its opponents' records BEFORE this game, so the fights of the lobby being
 *  stamped are subtracted from what the view reports. Without this the two stamps disagree: the client reads the
 *  view before its own upload lands (every unserved seat at the prior, 50) while the server settles after it
 *  (the same seven seats now carrying this very game's results, 47), and the number would depend on how the
 *  game you just played went. `settle_rank` applies the same exclusion by `lobby_seed`; this is the client's
 *  copy, fed the rows it is about to upload. A key's count never goes below 0. */
export function excludeOwnFights(inputs: readonly StrengthInput[], ownRows: readonly { runA: string; runB: string; outcome: 'a' | 'b' | 'draw' }[]): StrengthInput[] {
  if (ownRows.length === 0) return inputs.map((i) => ({ key: i.key, fights: i.fights, wins: i.wins }));
  const fights = new Map<string, number>();
  const wins = new Map<string, number>();
  for (const r of ownRows) {
    fights.set(r.runA, (fights.get(r.runA) ?? 0) + 1);
    fights.set(r.runB, (fights.get(r.runB) ?? 0) + 1);
    if (r.outcome === 'a') wins.set(r.runA, (wins.get(r.runA) ?? 0) + 1);
    if (r.outcome === 'b') wins.set(r.runB, (wins.get(r.runB) ?? 0) + 1);
  }
  return inputs.map((i) => ({
    key: i.key,
    fights: Math.max(0, i.fights - (fights.get(i.key) ?? 0)),
    wins: Math.max(0, i.wins - (wins.get(i.key) ?? 0)),
  }));
}

/** The lobby's strength from its opponents' records. An empty input list (no opponents known) reads 50 / Even. */
export function lobbyStrengthOf(inputs: readonly StrengthInput[]): LobbyStrength {
  const list = inputs.map((i) => ({ key: i.key, fights: i.fights, wins: i.wins }));
  const mean = list.length === 0 ? 0.5 : list.reduce((sum, i) => sum + seatStrengthRate(i), 0) / list.length;
  const value = Math.max(0, Math.min(100, Math.round(100 * mean)));
  return { value, tier: strengthTierOf(value), inputs: list };
}

/** The placement's weight on the bonus: 1.0 / 0.8 / 0.62 / 0.47 for 1st to 4th, 0 for 5th to 8th (and for
 *  anything that is not a placement). */
export function strengthPlacementWeight(placement: number): number {
  return Number.isInteger(placement) && placement >= 1 && placement <= STRENGTH_PLACEMENT_WEIGHTS.length
    ? STRENGTH_PLACEMENT_WEIGHTS[placement - 1]!
    : 0;
}

/** The strength factor: `clamp((s − 30) / 70, 0, 1)` — 0 at 30 and below, 1 at 100. */
export function strengthFactorOf(value: number): number {
  return Math.max(0, Math.min(1, (value - STRENGTH_BONUS_FLOOR) / STRENGTH_BONUS_SPAN));
}

/** The rating bonus a top-4 finish earns at strength `value`: `round(15 × weight × factor)`; 0 for 5th to 8th
 *  or a null strength. The multiplication order (max × weight × factor) is the SAME in all three copies so the
 *  doubles agree bit for bit before the round. */
export function strengthBonusOf(value: number | null | undefined, placement: number): number {
  const weight = strengthPlacementWeight(placement);
  if (weight <= 0 || value == null || !Number.isFinite(value)) return 0;
  return Math.round(STRENGTH_BONUS_MAX * weight * strengthFactorOf(value));
}

/** "47%" — the one label the Career and Recent Games rows print. A percentile-style number, no tier word
 *  (owner 2026-09-22: "remove the easy/medium/hard etc and just have it say for example, 47% since its
 *  basically a percentile"). The tier is still computed and stored (`tier`) for the data and the bonus copies;
 *  it is simply not printed. */
export function strengthText(s: Pick<LobbyStrength, 'value' | 'tier'>): string {
  return `${s.value}%`;
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
