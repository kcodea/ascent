/**
 * CONDUCTOR must resolve its Shout IN COMBAT (owner report 2026-08-26: "conductor isn't triggering in combat").
 *
 * `replayCombatBattlecry` runs a Shout live only when a COMBAT factory exists for its `do`; everything else is
 * classified as economy and deferred to settle. `battlecryConductorAdjacent` existed only as a RECRUIT factory,
 * so every in-combat re-fire — a Parting Cry, Ryme, Dawnclaw, Rune of Shared Scripture — silently did nothing.
 */
import { describe, expect, it } from 'vitest';
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
