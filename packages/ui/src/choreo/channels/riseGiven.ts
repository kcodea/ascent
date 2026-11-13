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

/** Does this card give ANOTHER minion Rise? The cards the workbench offers an "On Rise given" slot. */
export function givesRise(cardId: string | null | undefined): boolean {
  return !!cardId && !!CARD_INDEX[cardId]?.effects?.some((f) =>
    RISE_GIVING_EFFECTS.has(f.do) || (KEYWORD_PARAM_EFFECTS.has(f.do) && f.params?.keyword === 'R'));
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
