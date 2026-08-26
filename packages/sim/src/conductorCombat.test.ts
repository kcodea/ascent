/**
 * CONDUCTOR must resolve its Shout IN COMBAT (owner report 2026-08-26: "conductor isn't triggering in combat").
 *
 * `replayCombatBattlecry` runs a Shout live only when a COMBAT factory exists for its `do`; everything else is
 * classified as economy and deferred to settle. `battlecryConductorAdjacent` existed only as a RECRUIT factory,
 * so every in-combat re-fire — a Parting Cry, Ryme, Dawnclaw, Rune of Shared Scripture — silently did nothing.
 */
import { describe, expect, it } from 'vitest';
import { conductorText } from '../../ui/src/cardText';
import { snapshotBoard } from './snapshot';
import { sideFromSnapshot } from './boardSide';
import { createRun, type RunState } from './index';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';

const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra } as BoardMinion);
const buffs = (events: CombatEvent[]) =>
  events.filter((e) => (e as { type: string }).type === 'buff').map((e) => e as unknown as { attack: number; health: number; target: string });

describe('Conductor resolves its Shout in combat', () => {
  it("a PARTING CRY re-fire buffs the Conductor's live neighbours", () => {
    // Conductor between two bodies, dying with a parting cry armed → its Shout fires in combat.
    const r = simulate(
      // The neighbours must be ALIVE when the Conductor dies — `neighboursOf` is living-only, and a first
      // attempt with 1-health neighbours had them dead before the cry, which reads exactly like the bug.
      [bm('dw_orin', 'L', 4, 99), bm('n2_conductor', 'C', 1, 1, { partingCry: true }), bm('dw_orin', 'R', 4, 99)],
      [bm('sandbag', 'B', 6, 30)],
      makeRng(5), CARD_INDEX,
      combatSide({ tier: 4, conductorBuff: 1 }), combatSide({ tier: 6 }),
    );
    // Conductor's grant is +2/+3 × N. With N = 1 that is a +2/+3 buff landing on its neighbours.
    const conductorGrants = buffs(r.events).filter((b) => b.attack === 2 && b.health === 3);
    expect(conductorGrants.length, 'the Shout resolved in combat and buffed adjacents').toBeGreaterThan(0);
  });

  it('the snowball N scales the in-combat grant (N=3 → +6/+9)', () => {
    const r = simulate(
      [bm('dw_orin', 'L', 4, 99), bm('n2_conductor', 'C', 1, 1, { partingCry: true }), bm('dw_orin', 'R', 4, 99)],
      [bm('sandbag', 'B', 6, 30)],
      makeRng(5), CARD_INDEX,
      combatSide({ tier: 4, conductorBuff: 3 }), combatSide({ tier: 6 }),
    );
    expect(buffs(r.events).some((b) => b.attack === 6 && b.health === 9), 'N=3 pays +6/+9').toBe(true);
  });
});

/**
 * …and the printed number has to track what it actually does (owner report 2026-08-26: "its text in combat is
 * also not updating in real time"). Two separate framings; the card is misprinted by a whole step if the wrong
 * one is used.
 */
describe("Conductor's live text", () => {
  it('a SHOP offer reads what PLAYING it would grant; a BOARD/COMBAT body reads what it grants NOW', () => {
    // N = 3 already banked. Playing a fourth would make N = 4 → +8/+12.
    expect(conductorText('n2_conductor', false, 3), 'shop framing: the step you are about to take').toContain('{{+8/+12}}');
    // The same body already on the board has been played — N already counts it, so a re-fire pays 3 → +6/+9,
    // which is exactly what the arena grant applies.
    expect(conductorText('n2_conductor', false, 3, 1, true), 'board/combat framing: the CURRENT snowball').toContain('{{+6/+9}}');
  });

  it('at N = 0 the PRINTED text already tells the truth, in either framing', () => {
    // A body summoned / Discovered straight onto the board never went through the play path, so N is 0 and the
    // arena grant floors at 1 — i.e. exactly the +2/+3 the card already prints. Nothing to override, so the
    // helper stands down rather than re-rendering the same numbers.
    expect(conductorText('n2_conductor', false, 0, 1, true)).toBeNull();
    expect(conductorText('n2_conductor', false, 0)).toBeNull();
    expect(CARD_INDEX['n2_conductor']!.text).toContain('+2/+3');
  });

  it("a SERVED opponent's Conductor carries its own snowball into the fight, not N=1", () => {
    const snap = snapshotBoard({ ...createRun(5), conductorBuff: 4 } as RunState);
    expect(snap.conductorBuff, 'the capture records it').toBe(4);
    expect(sideFromSnapshot(snap, 5, []).conductorBuff, 'and the served side is seeded with it').toBe(4);
  });
});
