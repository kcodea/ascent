/**
 * Rune of Rebirth stamps `grantsEcho` on exactly ONE minion's Start-of-Combat event.
 *
 * That marker is what lets the UI print the granted Echo on the body that actually has it. The text used to
 * be driven by the run-wide rune flag, so every minion the player controlled claimed the rule (owner report
 * 2026-08-22). This pins the engine half: one grant, one marked uid, and it names a real friendly body.
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

const marked = (evs: CombatEvent[]): string[] =>
  evs.filter((e): e is Extract<CombatEvent, { type: 'sc' }> => e.type === 'sc' && !!(e as { grantsEcho?: true }).grantsEcho)
    .map((e) => e.source);

describe('Rune of Rebirth marks its one recipient', () => {
  it('marks exactly one minion', () => {
    expect(marked(fight(true).events)).toHaveLength(1);
  });

  it('the marked uid is a real friendly body on the board', () => {
    const r = fight(true);
    const uids = r.initial.player.map((m) => m.uid);
    expect(uids).toContain(marked(r.events)[0]);
  });

  it('without the rune nothing is marked — so nothing prints the tag', () => {
    expect(marked(fight(false).events)).toHaveLength(0);
  });
});
