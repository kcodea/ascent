/**
 * BALANCE BOT B9 — EXPERT LINE OPERATORS: the shared contract.
 *
 * The strategist (B4) chooses a LINE and steers a one-turn search with a prior; B6 / B7 gave that search an engine
 * gradient and a survivor table. Every one of them measured the same thing against the recorded set-2 players:
 * the pilot holds the right engine cards and never OPERATES them (stats ×1.2 a wave against the players' ×1.7).
 *
 * An OPERATOR is the other structure: a hand-authored, per-turn PROCEDURE for one line, written the way a strong
 * player plays it — the tier timing, what to buy in each phase, which engine to field first, how to feed it EVERY
 * turn, when to hold pairs, what to sell, what the hero power is for, and when to give up and hand the run back to
 * the strategist. The procedure is data + a few hooks (this file); `operatorPilot.ts` is the skeleton that runs any
 * of them one reducer-validated action at a time. Nothing here reads hidden state: every hook sees the
 * `BotVisibleState` projection and the player-visible fields of the run.
 */
import type { Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { Action, RunState } from '../../../state';
import type { BotCardView, BotOfferView, BotVisibleState } from '../../../productionBots/types';

export type OperatorLine = 'demon' | 'dwarf' | 'dragon' | 'beast';

/** How much a line wants a card: 0 = off-line filler; 1 = an on-line body / early tempo; 2 = an ENGINE piece or a
 *  feeder the engine wants; 3 = the CORE engine or its payoff (bought on sight, never sold). */
export type Want = 0 | 1 | 2 | 3;

export interface CardRole {
  want: Want;
  /** Prose for traces / the census. */
  note: string;
  /** A body the line fields only until the engine arrives — sold off from `SELL_FILLER_WAVE` when something
   *  better is available (the study: Embermouth Whelp past wave 6 = 4% survival). */
  filler?: boolean;
  /** The wave from which the card is worth buying (a Tier-6 payoff is not a wave-3 purchase). */
  fromWave?: number;
  /** A card whose value comes from DYING in combat (Right Hand Hank): it goes to the FRONT of the line. */
  diesForward?: boolean;
  /** THE engine the line is built around (Blart, Brunni, Chorus Drake, Echohorn): outranks every pair bonus, and
   *  the only thing worth delaying a due tier-up for. */
  core?: boolean;
}

/** What the turn has done so far — the per-seat, per-wave memory the skeleton keeps so a procedure can be
 *  re-derived from the live state on every call without oscillating (sell → buy → sell …). */
export interface TurnMemory {
  wave: number;
  rolls: number;
  froze: boolean;
  usedPower: boolean;
  /** Card ids bought this turn (never sold the same turn). */
  bought: Set<string>;
  /** Card ids sold this turn (never re-bought the same turn). */
  sold: Set<string>;
  /** Uids the operator has already tried to feed / cast / position this turn and the engine refused. */
  refused: Set<string>;
  /** Arrangement fingerprints visited this turn (the generic positioning pass never revisits one). */
  arranged: Set<string>;
  /** The line's own arrangement has been applied this turn. */
  orderedByLine: boolean;
  /** Uids a targeted spell was cast on this turn (Mirrorwing's once-per-turn recast). */
  castOn: Set<string>;
}

export interface LineOperator {
  id: OperatorLine;
  /** The strategist package ids that route to this operator. */
  packages: readonly string[];
  tribe: Tribe;
  /** `tierByWave[t]` = the wave by which Shop tier `t` (2..6) should be reached. Anchored on the recorded runs. */
  tierByWave: readonly [undefined, undefined, number, number, number, number, number];
  /** The hand-authored card table. Cards absent here fall to `defaultWant`. */
  roles: Readonly<Record<string, CardRole>>;
  /** Want for a card the table does not name (an on-tribe body early, a neutral engine, …). */
  defaultWant(cardId: string, v: BotVisibleState): Want;
  /** The card ids whose presence on the board means "the engine is running" — the pivot rule reads this. */
  engineIds: readonly string[];
  /** Line-specific FEED actions, in priority order, from the live state: the first legal one is taken. The
   *  skeleton has already fielded hand bodies and cast the generic spells; this is the line's own operation (a
   *  targeted eater, an Ale on the right body, a spell on Mirrorwing, …). */
  feed(v: BotVisibleState, run: RunState, mem: TurnMemory): Action[];
  /** The target for a spell / power that wants a friendly minion, or null for "no good target — do not cast". */
  spellTarget(v: BotVisibleState, spellId: string, mem?: TurnMemory): BotCardView | null;
  /** The answer to a targeted Shout the line fields (Appetite Agent, Baby Gastrid): a uid among `legal`. */
  aim(v: BotVisibleState, sourceCardId: string, legal: readonly string[]): string | null;
  /** The desired seat of a board card: lower = further LEFT (attacks first). Ties keep the current order. */
  slot(card: BotCardView, v: BotVisibleState): number;
  /** Cards whose seat the generic positioning pass may NOT move (the leftmost Echo, the forward Hank). */
  pinned(card: BotCardView, v: BotVisibleState): boolean;
  /** The hero power, when the line knows what it is for. Null = let the generic evaluator decide. */
  heroPower?(v: BotVisibleState, run: RunState, mem: TurnMemory): Action | null;
  /** Extra end-of-turn conditions the line needs (a Demon line never ends on an empty Shop). */
  beforeEnd?(v: BotVisibleState, run: RunState, mem: TurnMemory): Action | null;
  /** An offer the line must NOT buy right now (the Demon line leaves Blart's right-most meal in the row). */
  avoidBuying?(o: BotOfferView, v: BotVisibleState): boolean;
  /** Extra rolls the line wants after buying (a Dwarf line dumps leftover Gold into refreshes for its
   *  Gold-spent triggers). Returns the Gold it is willing to spend on rolls. */
  rollBudget?(v: BotVisibleState, mem: TurnMemory): number;
}

/** From this wave a filler body is sold whenever something better is available. */
export const SELL_FILLER_WAVE = 6;
/** By this wave an operator that has never fielded an engine piece hands the run back to the strategist. */
export const PIVOT_WAVE = 7;

// ── shared helpers ─────────────────────────────────────────────────────────────────────────────────────────

export const stats = (c: { attack: number; health: number }): number => c.attack + c.health;
export const isTribe = (c: { tribe: Tribe; tribe2?: Tribe }, t: Tribe): boolean => c.tribe === t || c.tribe2 === t;
export const onBoard = (v: BotVisibleState, cardId: string): BotCardView | undefined => v.board.find((c) => c.cardId === cardId);
export const countHeld = (v: BotVisibleState, cardId: string): number => [...v.board, ...v.hand].filter((c) => c.cardId === cardId && !c.golden).length;

/** A body whose whole value is its Shout: once fielded it is a plain body (Butcher, Tormentor, Agent, Broodfire,
 *  Warhorn Captain …) — sold like filler when a seat is needed. Read off the definition, never a hand list. */
export function isSpentOnBoard(cardId: string): boolean {
  const d = CARD_INDEX[cardId];
  if (!d || d.spell || d.effects.length === 0) return false;
  return d.effects.every((e) => e.on === 'onPlay') && !d.chooseOne?.length && !d.triggerMultiplier;
}

/** The line's want for a card, table first. */
export function wantOf(op: LineOperator, cardId: string, v: BotVisibleState): Want {
  const r = op.roles[cardId];
  if (r) {
    if (r.fromWave !== undefined && v.wave < r.fromWave) return r.want > 1 ? 1 : r.want;
    return r.want;
  }
  return op.defaultWant(cardId, v);
}

/** Buy appeal of an offer: want, plus the pair / triple bonus, plus an early-body bonus while the board is thin. */
export function offerAppeal(op: LineOperator, o: BotOfferView, v: BotVisibleState): number {
  if (o.spell || o.ruby) return 0; // spells are scored by `spells.ts`
  const want = wantOf(op, o.cardId, v);
  const held = countHeld(v, o.cardId);
  let score = want * 10;
  if (op.roles[o.cardId]?.core) score += 15; // THE engine outranks any pair
  if (held === 2) score += 25; // the triple: a golden + a tier-up Discover
  else if (held === 1 && want >= 1) score += 8; // a pair held is two-thirds of a golden
  // An off-line body is still a body on waves 1–3 (the study's survivors opened on Chipwick / Pimm / Cinderchef
  // whatever their line): worth its stats, never more than an on-line one.
  if (want === 0 && held === 0) return v.wave <= 3 && v.board.length < 3 ? 5 + stats(o) / 2 : score;
  // A thin board wants a body — any on-line body — through the first waves.
  const bodies = v.board.length + v.hand.filter((c) => c.attack + c.health > 1).length;
  if (bodies < 3 && v.wave <= 5) score += 6;
  score += stats(o) / 10 + o.tier * 0.3;
  return score;
}

/** Keep value of a fielded card — what selling it would cost the line. Engines are effectively unsellable. */
export function keepValue(op: LineOperator, c: BotCardView, v: BotVisibleState): number {
  const role = op.roles[c.cardId];
  // A Shout-only body has cashed its value the moment it was played: on the board it is worth its stats.
  const want = isSpentOnBoard(c.cardId) ? Math.min(1, wantOf(op, c.cardId, v)) : wantOf(op, c.cardId, v);
  let score = want * 10;
  if (role?.core) score += 20;
  if (want >= 3) score += 100;
  if (c.golden) score += 30;
  if (countHeld(v, c.cardId) >= 2 && want >= 1) score += 8; // a pair is worth holding for the triple
  if (role?.filler && v.wave >= SELL_FILLER_WAVE) score -= 8;
  score += stats(c) / 4;
  return score;
}
