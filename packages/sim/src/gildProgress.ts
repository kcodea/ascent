/**
 * GILDING KEEPS PROGRESS (owner report 2026-11-18, R-GILD-PROGRESS-01).
 *
 *   "minions that track anything like spend etc should not reset when gilded. aka a Billings at 9/10 when gilded
 *    should be at the furthest progress of the cards that tripled."
 *
 * ONE helper for every per-instance PROGRESS TRACKER a minion can carry. When copies combine into a Gilded minion
 * (`combineIntoGolden`: a natural triple, a 2-copy gild under Midas' Touch / Twin Gilding / Gilded Shortcut, board and
 * hand copies alike) the Gilded minion starts at the FURTHEST progress among the copies that merged: the highest
 * count, never the sum and never zero. An IN-PLACE gild (`gildMinion`, the Start of Combat gilds, Auric Runemaster)
 * keeps the same instance, so its trackers were never lost and need nothing from here.
 *
 * Data-driven: a tracker is carried by FIELD, keyed on what the card's printed effects read, never on a card id. A new
 * card on an existing meter is covered the day it ships; a new meter field joins `GILD_PROGRESS_TRACKERS`.
 *
 * A REDUCED cadence meter (stored as the remainder below its threshold: `goldTick`, `buyTick`, `playTick`,
 * `shoutTick`, `orbitTick`) is clamped to `every - 1`. Every copy of one card shares one threshold (Gilded doubles the
 * payout, not the cadence), so the clamp never bites today; it is the guarantee that a merge can never land a meter AT
 * its threshold, so a merge never fires a payout and the next tick can never fire twice.
 *
 * NOT here, on purpose: accumulated VALUES (`summonBonus`, `overflowBonus`, `hpGrantBonus`, the welds, Seed stacks,
 * kept Whisper stats) keep their own owner-ruled merges in `combineIntoGolden` / `seedEchoMerge`; `spellProgress`,
 * `ascendProgress`, `damageDealt` and `whisperTick` already took the highest copy there.
 */
import type { CardDef, EffectDef } from '@game/core';
import type { BoardCard } from './state';

type TrackerField = 'goldTick' | 'buyTick' | 'playTick' | 'rubyCastTick' | 'shoutTick' | 'orbitTick' | 'soldProgress' | 'spiritTally' | 'eotTick';

interface Tracker {
  field: TrackerField;
  /** The printed effect that OWNS this meter on a card. Absent = the field is a meter on every card that carries it. */
  owner?: (e: EffectDef) => boolean;
  /** Carry only when the card has an `owner` effect (the field means something else on other cards). */
  ownerOnly?: boolean;
  /** `clamp`: stored below its threshold, so cap at `every - 1`. `mod`: a running count read `% every`, keep the cycle
   *  position. Absent: a raw count, carried as is. Both need the `owner` effect's `every`. */
  shape?: 'clamp' | 'mod';
  fallbackEvery?: number;
}

const everyOf = (e: EffectDef | undefined): number | undefined => {
  const v = (e?.params as { every?: unknown } | undefined)?.every;
  return typeof v === 'number' && v >= 1 ? v : undefined;
};
const hasEvery = (e: EffectDef): boolean => everyOf(e) !== undefined;

/** Every per-instance progress tracker a triple carries, in one table. */
export const GILD_PROGRESS_TRACKERS: readonly Tracker[] = [
  // "Every N Gold spent" (Billings, Acid, Banksly, Coinfire Forewoman): the remainder toward the next payout.
  { field: 'goldTick', owner: (e) => e.on === 'goldSpent', ownerOnly: true, shape: 'clamp', fallbackEvery: 7 },
  // "Every N cards bought" (Korok). On a card with no `cardsBought` meter the field is a CHARGES-USED count (the
  // buy-a-minion-get-a-spell charges), which is not progress toward a trigger: left to its own rule.
  { field: 'buyTick', owner: (e) => e.on === 'cardsBought', ownerOnly: true, shape: 'clamp', fallbackEvery: 4 },
  // "After you play N cards" (Mountainbond).
  { field: 'playTick', owner: (e) => e.on === 'cardsPlayed', ownerOnly: true, shape: 'clamp', fallbackEvery: 8 },
  // "Every N spells or Rubies cast" (Gemgorge Fiend): a running count, payouts on each multiple crossed.
  { field: 'rubyCastTick' },
  // "Every N Shouts" (Scalechanter, Living Grimoire).
  { field: 'shoutTick', owner: (e) => e.do === 'onBattlecryImproveSelf' || e.do === 'onBattlecryRearmGrimoire', shape: 'clamp', fallbackEvery: 3 },
  // "Orbit (N)" and "after N Orbits".
  { field: 'orbitTick', owner: (e) => (e.on === 'orbit' || e.on === 'orbitFired') && hasEvery(e), shape: 'clamp' },
  // "When you sell N minions" (Runic Archivist, Mariet, Grevlin & Co, Valyou, Leeds).
  { field: 'soldProgress' },
  // Spirits played while this was on the board (Festival Keeper, Aspect, Forest Colossus).
  { field: 'spiritTally' },
  // End of Turn cadences keep their cycle position (Frontdrake, Money Maker: the long-standing rule); every other
  // reader of the field is a running count (the Refresh meters, turns seen), carried as is.
  { field: 'eotTick', owner: (e) => e.on === 'endOfTurn' && hasEvery(e), shape: 'mod', fallbackEvery: 3 },
];

/**
 * The progress trackers a Gilded `def` starts with when `combined` merge into it: each one the FURTHEST of the copies.
 * Only nonzero values are returned (an unset meter stays unset, exactly like a fresh card).
 */
export function gildProgressCarry(def: CardDef, combined: readonly BoardCard[]): Partial<Pick<BoardCard, TrackerField>> {
  const out: Partial<Record<TrackerField, number>> = {};
  for (const t of GILD_PROGRESS_TRACKERS) {
    const owner = t.owner ? def.effects.find(t.owner) : undefined;
    if (t.ownerOnly && !owner) continue;
    const every = owner ? Math.max(1, everyOf(owner) ?? t.fallbackEvery ?? 1) : undefined;
    const position = (c: BoardCard): number => {
      const v = Math.max(0, c[t.field] ?? 0);
      if (every === undefined || !t.shape) return v;
      return t.shape === 'mod' ? v % every : Math.min(v, every - 1);
    };
    const furthest = combined.reduce((best, c) => Math.max(best, position(c)), 0);
    if (furthest > 0) out[t.field] = furthest;
  }
  return out;
}
