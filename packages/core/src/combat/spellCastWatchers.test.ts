import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * MID-COMBAT SPELL CASTS FEED THE SPELL-CAST WATCHERS (owner audit 2026-08-02, from the Fatecarver board).
 *
 * Fatecarver's Growth branch (like Taragosa and Ashen Broodlord) fires `ctx.castSpell` — a REAL cast. But two
 * watcher effects existed only in the recruit table, so combat casts silently skipped them: Runebloom
 * Matriarch (+3/+3 to 3 Beasts per cast — the owner's board) and Fatecarver's own branch A (one minion of
 * each type per cast). Both now have combat halves. Thunderous Sovereign's accrual (`onSpellCastImproveSummon`)
 * already had one — pinned here too, with its carry-back, so the whole reported interaction is under test.
 */
const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 900 }];
const buffsFrom = (events: readonly CombatEvent[], sourceUid: string) =>
  events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === sourceUid);

// Fatecarver locked to branch B (option 1): every friendly attack casts a Growth.
const fatecarver: BoardMinion = { cardId: 'n2_fatecarver', attack: 4, health: 60, sourceUid: 'FC', chosenOption: 1 };

describe('Fatecarver’s mid-combat Growth is a real cast for every watcher', () => {
  it('Runebloom Matriarch procs on each cast (the owner’s board)', () => {
    const r = simulate(
      [fatecarver, { cardId: 'b2_runebloom', attack: 8, health: 60, sourceUid: 'RB' }],
      wall, makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast', 'dragon'] }), combatSide({ tier: 1 }));
    const procs = buffsFrom(r.events, 'm1'); // buff events carry the combat uid — Runebloom is board slot 1
    expect(procs.length, 'the Matriarch never saw the cast').toBeGreaterThan(0);
    expect(procs.every((b) => b.attack === 3 && b.health === 3)).toBe(true);
  });

  it('Thunderous Sovereign gains a stack per cast, and the accrual carries back to the run', () => {
    const r = simulate(
      [fatecarver, { cardId: 'd2_sovereign', attack: 8, health: 60, sourceUid: 'TS' }],
      wall, makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast', 'dragon'] }), combatSide({ tier: 1 }));
    const carried = (r.playerSummonBonus ?? []).find((b) => b.sourceUid === 'TS');
    expect(carried, 'the Sovereign accrued nothing from the casts').toBeTruthy();
    expect(carried!.bonus).toBeGreaterThan(0);
  });

  it("Fatecarver branch A procs off ANOTHER caster's mid-combat spell", () => {
    // A second Fatecarver on branch A (option 0) watches the branch-B one's Growth casts: each cast buffs one
    // living minion of each type, deterministically in board order.
    const r = simulate(
      [fatecarver, { cardId: 'n2_fatecarver', attack: 4, health: 60, sourceUid: 'FA', chosenOption: 0 },
       { cardId: 'pack', attack: 2, health: 40, sourceUid: 'P' }],
      wall, makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast', 'dragon'] }), combatSide({ tier: 1 }));
    const procs = buffsFrom(r.events, 'm1'); // the branch-A watcher sits in board slot 1
    expect(procs.length, 'branch A never saw the cast').toBeGreaterThan(0);
    expect(procs.every((b) => b.attack === 2 && b.health === 2)).toBe(true);
  });
});
