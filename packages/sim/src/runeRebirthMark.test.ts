/**
 * Rune of Rebirth grants REBIRTH (`RB`) to exactly ONE minion at Start of Combat — as a `keyword` event.
 *
 * History: the rune used to graft an exact-copy Echo and mark it with `sc.grantsEcho`, which the UI printed as a
 * per-body text tag (owner report 2026-08-22: the run-flag-driven text had tagged all seven bodies). Since
 * 2026-09-16 the rune grants a KEYWORD, so the per-instance read is the pill itself — one `keyword` event, one
 * body. This pins the engine half: one grant, one uid, and it names a real friendly body.
 */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';

const board = (): BoardMinion[] => ([
  { cardId: 'b2_packstrider', attack: 3, health: 8, keywords: [] },
  { cardId: 'b2_wolvie', attack: 3, health: 8, keywords: [] },
  { cardId: 'kennel', attack: 3, health: 8, keywords: [] },
] as never[]);

const fight = (rebirth: boolean) => simulate(
  board(), [{ cardId: 'sandbag', attack: 0, health: 400 }] as never[], makeRng(11), CARD_INDEX,
  combatSide({ tier: 3, tribes: ['beast'], ...(rebirth ? { questMods: { runeRebirth: true } } : {}) } as never),
  combatSide({ tier: 1 }),
);

const granted = (evs: CombatEvent[]): string[] =>
  evs.filter((e): e is Extract<CombatEvent, { type: 'keyword' }> => e.type === 'keyword' && e.keyword === 'RB').map((e) => e.target);

describe('Rune of Rebirth grants Rebirth to its one recipient', () => {
  it('grants exactly one minion', () => {
    expect(granted(fight(true).events)).toHaveLength(1);
  });

  it('the granted uid is a real friendly body on the board', () => {
    const r = fight(true);
    const uids = r.initial.player.map((m) => m.uid);
    expect(uids).toContain(granted(r.events)[0]);
  });

  it('without the rune nothing is granted — so no pill appears', () => {
    expect(granted(fight(false).events)).toHaveLength(0);
  });
});
