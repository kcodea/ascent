import type { CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { Moment } from '../compile';

/** The effects whose whole job is giving another minion Rise. */
const RISE_GIVING_EFFECTS: ReadonlySet<string> = new Set([
  'deathrattleGrantReborn',    // Mumi
  'deathrattleGrantRebornAll', // Anubis
  'scGrantReborn',             // Gravewarden
]);
/** The effects that give a keyword named by their `keyword` param; one that names Rise gets the slot too. */
const KEYWORD_PARAM_EFFECTS: ReadonlySet<string> = new Set([
  'deathrattleBuffRandomTribe',    // Wolvie
  'rallyGrantKeywordRandomTribe',
  'avengeGrantKeywordRandomTribe',
]);

/** Does one effect give another minion Rise? */
const effectGivesRise = (f: { do: string; params?: Record<string, unknown> }): boolean =>
  RISE_GIVING_EFFECTS.has(f.do)
  || (KEYWORD_PARAM_EFFECTS.has(f.do) && f.params?.keyword === 'R')
  // A targeted Shout that grants keywords (Runic Beetle's Rise option).
  || (f.do === 'battlecryGrantKeyword' && Array.isArray(f.params?.keywords) && f.params.keywords.includes('R'));

/**
 * Does this card give ANOTHER minion Rise? The cards the workbench offers an "On Rise given" slot. A Choose One
 * card counts when any of its options does (Runic Beetle).
 */
export function givesRise(cardId: string | null | undefined): boolean {
  const def = cardId ? CARD_INDEX[cardId] : undefined;
  if (!def) return false;
  return !!def.effects?.some(effectGivesRise) || !!def.chooseOne?.some((o) => o.effects?.some(effectGivesRise));
}

/**
 * THE SHOP, MID-TURN: the Rises a minion PLAYED this action gave (Runic Beetle's Choose One option). A mid-turn action
 * plays no presentation batch (production resolves it without one), so the grant is read off the board itself: a
 * minion that was on the board WITHOUT Rise and now has it, in the same action that put a Rise-giving minion on the
 * board. `prev` maps each uid on the board before the action to whether it had Rise. A Rise the played minion gave
 * itself is not a travel.
 */
export function playedRiseGrants(
  prev: ReadonlyMap<string, boolean>,
  board: ReadonlyArray<{ uid: string; cardId: string; keywords: readonly string[] }>,
): Array<{ cardId: string; source: string; target: string }> {
  const giver = board.find((c) => !prev.has(c.uid) && givesRise(c.cardId));
  if (!giver) return [];
  return board
    .filter((c) => prev.get(c.uid) === false && c.keywords.includes('R'))
    .map((c) => ({ cardId: giver.cardId, source: giver.uid, target: c.uid }));
}

export interface RiseGiven {
  /** The giving card (the binding's key). */
  cardId: string;
  /** The giving body. The engine stamps it on the grant, so a forced Echo (Spots, Echohorn) names the Echo's owner. */
  source: string;
  target: string;
  /** The giver DIED earlier in this same moment (its Echo): the effect leaves from its slot, after its skull. */
  died: boolean;
}

/**
 * Every Rise a minion GAVE another minion in this moment: a `keyword` event for Rise that names its source. A Rise a
 * body gave ITSELF (a regained Rise) is not a travel and is left out.
 */
export function risesGivenIn(moment: Moment, events: CombatEvent[], cardIds: ReadonlyMap<string, string> | undefined): RiseGiven[] {
  const out: RiseGiven[] = [];
  const dead = new Set<string>();
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (e?.type === 'death') { dead.add(e.target); continue; }
    if (e?.type !== 'keyword' || e.keyword !== 'R' || typeof e.source !== 'string' || e.source === e.target) continue;
    const cardId = cardIds?.get(e.source);
    if (cardId) out.push({ cardId, source: e.source, target: e.target, died: dead.has(e.source) });
  }
  return out;
}
