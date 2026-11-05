import type { CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { Moment } from '../compile';

/** The effects that GIVE another minion Ward — the cards the workbench offers an "On Ward given" slot. */
export const WARD_GIVING_EFFECTS: ReadonlySet<string> = new Set([
  'deathrattleGrantWardRandom', // Lastlight
  'deathrattleGrantShield',
  'scGrantShieldTribe',
]);

export interface WardGiven {
  cardId: string;
  /** The giving body: the dying card for an Echo, else the event's own source; null = resolve by card. */
  source: string | null;
  target: string;
  /** A FORCED Echo (Spots, Echohorn, Deathsayer): the giver is ALIVE, named by the `rally` that fired its Echo. */
  forced?: boolean;
  /** The `rally` event's index for a forced fire: Wards sharing it came from the same fire. */
  fire?: number;
}

/** Does this card's Echo give Ward? (A forced Echo stamps the TRIGGER's card, so the giver is found by card.) */
function echoGivesWard(cardId: string | undefined): boolean {
  return !!cardId && !!CARD_INDEX[cardId]?.effects?.some((f) => f.on === 'onDeath' && WARD_GIVING_EFFECTS.has(f.do));
}

/**
 * Every Ward a card GAVE in this moment (`shieldUp` stamped with `srcCard` by a Ward-giving effect). An Echo's
 * giver has already died in the same moment, so it is found by its `death` event: that is where the effect starts.
 */
export function wardsGivenIn(moment: Moment, events: CombatEvent[], cardIds: ReadonlyMap<string, string> | undefined): WardGiven[] {
  const out: WardGiven[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (e?.type !== 'shieldUp') continue;
    // A FORCED Echo (Spots' Start of Combat, an Echohorn Rally) logs `rally { target: giver }` and then the Echo's own
    // events stamped with the TRIGGER's card, so a Ward right after a rally on a Ward-giving Echo is that giver's
    // (owner report 2026-11-04: Spots firing Lastlight showed no beam). The rally sits in the beat before.
    let back = i - 1;
    while (back >= 0 && events[back]?.type === 'shieldUp') back--;
    const r = events[back];
    if (r?.type === 'rally' && typeof r.target === 'string' && echoGivesWard(cardIds?.get(r.target))) {
      out.push({ cardId: cardIds!.get(r.target)!, source: r.target, target: e.target, forced: true, fire: back });
      continue;
    }
    if (typeof e.srcCard !== 'string' || typeof e.key !== 'string') continue;
    const factory = e.key.split(':')[1] ?? '';
    if (!WARD_GIVING_EFFECTS.has(factory)) continue;
    let source: string | null = null;
    for (let j = i - 1; j >= moment.start && source === null; j--) {
      const d = events[j];
      if (d?.type === 'death' && cardIds?.get(d.target) === e.srcCard) source = d.target;
    }
    out.push({ cardId: e.srcCard, source, target: e.target });
  }
  return out;
}

/**
 * The Wards GAINED in this moment that the `fxDef` row does not already tell (R-FX-WARD-GAIN-EVERY-01): every keyed or
 * unkeyed `shieldUp` except the moment's own primary on a `shieldGain` moment (fxDef plays that one), and except a
 * Ward whose giver travels to it (`deferred`: the "On Ward given" launch plays the Ward-gained effect when it lands).
 * One entry per event, so a card that wards three minions plays the effect on all three.
 */
export function extraWardGainsIn(
  moment: Moment,
  events: CombatEvent[],
  cardIds: ReadonlyMap<string, string> | undefined,
  deferred: (w: WardGiven) => boolean,
): Array<{ target: string; srcCard: string | null }> {
  const travelled = new Set(wardsGivenIn(moment, events, cardIds).filter(deferred).map((w) => w.target));
  const out: Array<{ target: string; srcCard: string | null }> = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (e?.type !== 'shieldUp') continue;
    if (moment.kind === 'shieldGain' && i === moment.start) continue; // the primary: compile puts it first
    if (travelled.has(e.target)) continue;
    out.push({ target: e.target, srcCard: typeof e.srcCard === 'string' ? e.srcCard : null });
  }
  return out;
}
