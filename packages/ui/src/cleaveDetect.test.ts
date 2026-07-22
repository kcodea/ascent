import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import { ALL_CARDS } from '@game/content';
import { buildBeats, isCleaveImpact, meleePairOfImpact } from './combatBeats';

/** A card id from the live pool that actually prints Cleave — resolved from the pool so the suite fails
 *  loudly if the Cleave carriers are ever retired, rather than passing on an empty lookup. */
const CLEAVE_CARD = (() => {
  const hit = ALL_CARDS.find((c) => c.keywords.includes('C'));
  if (!hit) throw new Error('no Cleave card in the pool — update this fixture');
  return hit.id;
})();

/**
 * `isCleaveImpact` decides whether a melee exchange throws the claw-slash volley instead of the generic
 * per-victim damage burst. Owner call 2026-07-21: the **Cleave keyword** only — Mauron's per-card
 * `splashAdjacent` keeps the ordinary burst — and a mid-combat grant/strip of the keyword must be honoured.
 */
describe('isCleaveImpact (Cleave claw-slash gate)', () => {
  // `gnash` (Gnasher) is a plain melee body; `mauron` splashes via splashAdjacent but has no C keyword.
  // A Cleave carrier is built by granting the keyword, which also exercises the mid-combat-grant path.
  const attack = (attacker: string, defender: string): CombatEvent =>
    ({ type: 'attack', attacker, defender, swing: 4 }) as CombatEvent;
  const dmg = (target: string): CombatEvent => ({ type: 'dmg', target, amount: 4, remainingHp: 1 }) as CombatEvent;

  /** The index of the RESULT beat (the one holding the dmg run) for a single attack log. */
  const resultIndex = (events: CombatEvent[]): number => {
    const beats = buildBeats(events);
    return beats.findIndex((b) => events[b.start]?.type === 'dmg');
  };

  it('is false for a plain melee attack (no Cleave anywhere)', () => {
    const events = [attack('a1', 'd1'), dmg('d1'), dmg('a1')];
    const beats = buildBeats(events);
    const i = resultIndex(events);
    const ids = new Map([['a1', 'gnash'], ['d1', 'gnash']]);
    expect(meleePairOfImpact(beats, i)).toEqual({ attacker: 'a1', defender: 'd1' });
    expect(isCleaveImpact(beats, events, i, ids)).toBe(false);
  });

  it('is true when the attacker CARD prints Cleave', () => {
    // 'cleaver' is a real Cleave-keyword card in the pool; assert the fixture actually carries C so this
    // test fails loudly if the card is ever retired rather than silently passing on a missing lookup.
    const events = [attack('a1', 'd1'), dmg('d1'), dmg('d2'), dmg('a1')];
    const beats = buildBeats(events);
    const i = resultIndex(events);
    const ids = new Map([['a1', CLEAVE_CARD], ['d1', 'gnash'], ['d2', 'gnash']]);
    expect(isCleaveImpact(beats, events, i, ids)).toBe(true);
  });

  it('is true when Cleave was GRANTED mid-combat, and false again once it is stripped', () => {
    const granted: CombatEvent[] = [
      { type: 'keyword', target: 'a1', keyword: 'C' } as CombatEvent,
      attack('a1', 'd1'), dmg('d1'), dmg('d2'), dmg('a1'),
    ];
    const gBeats = buildBeats(granted);
    expect(isCleaveImpact(gBeats, granted, resultIndex(granted), new Map([['a1', 'gnash']]))).toBe(true);

    const stripped: CombatEvent[] = [
      { type: 'keyword', target: 'a1', keyword: 'C' } as CombatEvent,
      { type: 'keywordLost', target: 'a1', keyword: 'C' } as CombatEvent,
      attack('a1', 'd1'), dmg('d1'), dmg('a1'),
    ];
    const sBeats = buildBeats(stripped);
    expect(isCleaveImpact(sBeats, stripped, resultIndex(stripped), new Map([['a1', 'gnash']]))).toBe(false);
  });

  it('ignores a grant that happens AFTER this moment (no leaking backwards)', () => {
    const events: CombatEvent[] = [
      attack('a1', 'd1'), dmg('d1'), dmg('a1'),
      { type: 'keyword', target: 'a1', keyword: 'C' } as CombatEvent, // granted later in the fight
    ];
    const beats = buildBeats(events);
    expect(isCleaveImpact(beats, events, resultIndex(events), new Map([['a1', 'gnash']]))).toBe(false);
  });

  it('is false for a non-melee moment (Start-of-Combat damage has no attacker pair)', () => {
    const events: CombatEvent[] = [
      { type: 'sc', source: 's1', text: 'zap', cast: true } as CombatEvent,
      dmg('d1'), dmg('d2'),
    ];
    const beats = buildBeats(events);
    const i = resultIndex(events);
    expect(meleePairOfImpact(beats, i)).toBeNull();
    expect(isCleaveImpact(beats, events, i, new Map([['s1', CLEAVE_CARD]]))).toBe(false);
  });
});

