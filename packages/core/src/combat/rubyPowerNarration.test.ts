import { describe, it, expect } from 'vitest';
import { combatSide, simulate, makeRng, type BoardMinion } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * Ruby strength gained MID-COMBAT has to announce itself (owner report 2026-07-24: "the mid combats don't
 * trigger until combat resolution").
 *
 * `gainRubyBonus` used to accumulate silently and only surface at settle via `playerRubyBonusGain`, so the UI
 * had nothing to hang a cue on at the moment the Avenge actually fired — the Rubies in hand only reacted once
 * the run state changed, which is combat resolution. It now emits an `sc` narration the moment it happens,
 * matching `grantSpellPower`'s existing shape so the combat replay can parse both identically.
 *
 * This test pins that CONTRACT — the event type, the exact text format, and the source uid — because the
 * replay's mid-combat handler matches on `/^\+(-?\d+)\/\+(-?\d+) Ruby Power$/` and gates on the source being a
 * player unit. A silent change to any of those three re-breaks the cue with nothing else failing.
 */

/** Veinbreaker (Avenge 3: buff your Rubies +1/+1) behind THREE fragile allies, against one big attacker.
 *  Re-fixtured 2026-07-27: Veinbreaker became a Choose One and no longer grants Ruby strength in combat, so
 *  the source is now Faultline Scrapper's Echo (`deathrattleRubyStatGain`) — a fragile body that dies and pays
 *  out. The narration path under test is the same; only the card producing the gain changed. */
const board: BoardMinion[] = [
  { cardId: 'k_faultline', attack: 1, health: 1, keywords: [] },
  { cardId: 'sandbag', attack: 0, health: 200, keywords: [] },
];
const bigEnemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 10, health: 400 }];

const fight = (seed: number) =>
  simulate(board, bigEnemy, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));

describe('Ruby Power mid-combat narration', () => {
  it('emits an `sc` event the moment Ruby strength is gained, not only at settle', () => {
    const { events, playerRubyBonusGain } = fight(7);
    // The gain must actually have happened, or the assertion below would pass vacuously on a content change.
    expect(playerRubyBonusGain).toBeDefined();

    const rubyNarrations = events.filter(
      (e): e is Extract<typeof e, { type: 'sc' }> => e.type === 'sc' && /Ruby Power$/.test(e.text ?? ''),
    );
    expect(rubyNarrations.length).toBeGreaterThan(0);

    // The exact format the combat replay parses. Keep this regex identical to the one in `useCombatReplay`.
    const first = rubyNarrations[0]!;
    expect(first.text).toMatch(/^\+(-?\d+)\/\+(-?\d+) Ruby Power$/);
    // Sourced to the unit that caused it, so the flourish can play OVER that minion. The replay also gates on
    // this being a player uid — an unsourced event would be dropped and the cue would silently never show.
    expect(first.source).toBeTruthy();

    // It lands DURING the fight: there is combat still to come after the narration, which is the whole point.
    const idx = events.indexOf(first);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(events.length - 1);
  });

  it('the narrated amount matches the strength actually carried back', () => {
    const { events, playerRubyBonusGain } = fight(7);
    const narrated = events
      .filter((e) => e.type === 'sc' && /Ruby Power$/.test(e.text ?? ''))
      .reduce(
        (acc, e) => {
          const m = /^\+(-?\d+)\/\+(-?\d+) Ruby Power$/.exec((e as { text?: string }).text ?? '');
          return m ? { attack: acc.attack + Number(m[1]), health: acc.health + Number(m[2]) } : acc;
        },
        { attack: 0, health: 0 },
      );
    expect(narrated).toEqual(playerRubyBonusGain);
  });
});
