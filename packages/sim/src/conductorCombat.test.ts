/**
 * CONDUCTOR must resolve its Shout IN COMBAT (owner report 2026-08-26: "conductor isn't triggering in combat").
 *
 * `replayCombatBattlecry` runs a Shout live only when a COMBAT factory exists for its `do`; everything else is
 * classified as economy and deferred to settle. `battlecryConductorAdjacent` existed only as a RECRUIT factory,
 * so every in-combat re-fire — a Parting Cry, Ryme, Dawnclaw, Rune of Shared Scripture — silently did nothing.
 *
 * Since the owner's 2026-09-23 rework ("give adjacent minions +2/+3 and improve this") the grant is base + THIS
 * COPY's accrued `summonBonus` (the run-wide `conductorBuff` snowball is dormant), and a combat re-fire improves
 * the copy exactly like a shop fire does — one arena body, both phases.
 */
import { describe, expect, it } from 'vitest';
import { conductorText } from '../../ui/src/cardText';
import { snapshotBoard } from './snapshot';
import { opponentBoard } from './opponents';
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
      combatSide({ tier: 4 }), combatSide({ tier: 6 }),
    );
    // A fresh copy's grant is the printed +2/+3, landing on both neighbours.
    const conductorGrants = buffs(r.events).filter((b) => b.attack === 2 && b.health === 3);
    expect(conductorGrants.length, 'the Shout resolved in combat and buffed adjacents').toBeGreaterThan(0);
  });

  it("the copy's accrual scales the in-combat grant (accrual 3 → +5/+6) and the re-fire improves it again", () => {
    const r = simulate(
      [bm('dw_orin', 'L', 4, 99), bm('n2_conductor', 'C', 1, 1, { partingCry: true, summonBonus: 3 }), bm('dw_orin', 'R', 4, 99)],
      [bm('sandbag', 'B', 6, 30)],
      makeRng(5), CARD_INDEX,
      combatSide({ tier: 4 }), combatSide({ tier: 6 }),
    );
    expect(buffs(r.events).some((b) => b.attack === 5 && b.health === 6), 'accrual 3 pays +5/+6').toBe(true);
    expect((r.playerSummonBonus ?? []).find((b) => b.sourceUid === 'C')?.bonus, 'and the copy carries 4 back to the shop').toBe(4);
  });
});

/**
 * …and the printed number has to track what it actually does (owner report 2026-08-26: "its text in combat is
 * also not updating in real time"). One framing since the per-copy rework: every surface prints what the NEXT
 * fire of this copy grants, because the arena body grants first and improves after.
 */
describe("Conductor's live text", () => {
  it('a shop offer, a board body and a combat body all read (base + accrual) × golden', () => {
    expect(conductorText('n2_conductor', false, 3)).toContain('{{+5/+6}}');
    expect(conductorText('n2_conductor', true, 3), 'gilded doubles the applied grant').toContain('{{+10/+12}}');
  });

  it('at zero accrual the PRINTED text already tells the truth', () => {
    // A fresh copy — bought, summoned or Discovered straight onto the board — pays exactly the +2/+3 the card
    // prints. Nothing to override, so the helper stands down rather than re-rendering the same numbers.
    expect(conductorText('n2_conductor', false, 0)).toBeNull();
    expect(CARD_INDEX['n2_conductor']!.text).toContain('+2/+3');
  });

  it("a SERVED opponent's Conductor carries its own accrual into the fight, not the printed base", () => {
    const s: RunState = {
      ...createRun(5),
      board: [{ uid: 'c', cardId: 'n2_conductor', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false, summonBonus: 4 }],
    };
    const snap = snapshotBoard(s);
    expect(snap.minions[0]!.summonBonus, 'the capture records it').toBe(4);
    expect(opponentBoard(snap)[0]!.summonBonus, 'and the served body is seeded with it').toBe(4);
  });
});
