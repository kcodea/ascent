import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';
// RE-PIN 2026-10-10: Fatecarver's Growth branch was retired (owner balance batch), so this Growth-on-ally-attack
// fixture is Taragosa, the other live `onAllyAttackCastGrowth` caster (+3/+4 Growth instead of +1/+1).

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
const fatecarver: BoardMinion = { cardId: 'taragosa', attack: 4, health: 60, sourceUid: 'FC' };

describe('Fatecarver’s mid-combat Growth is a real cast for every watcher', () => {
  it('Runekeg procs on each cast — the per-cast watcher shape Runebloom used to carry', () => {
    // This case was Runebloom Matriarch until its 2026-08-07 rework moved it off per-cast payouts and onto a
    // Start-of-Combat cast multiplier (now covered in combatSpellCast.test.ts). Runekeg is the same effect
    // (`onSpellCastBuffRandomTribe`), so the watcher path the original report was about stays under test.
    // Runekeg is "2 random OTHER friendly Dwarves", so the board needs a second Dwarf or it has no targets.
    const r = simulate(
      [fatecarver, { cardId: 'dw_runekeg', attack: 8, health: 60, sourceUid: 'RK' },
       { cardId: 'dw_soldier', attack: 3, health: 60, sourceUid: 'DW' }],
      wall, makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['dwarf', 'dragon'] }), combatSide({ tier: 1 }));
    const procs = buffsFrom(r.events, 'm1'); // buff events carry the combat uid — Runekeg is board slot 1
    expect(procs.length, 'the watcher never saw the cast').toBeGreaterThan(0);
    expect(procs.every((b) => b.attack === 2 && b.health === 1)).toBe(true);
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

  it("Fatecarver procs off ANOTHER caster's mid-combat spell", () => {
    // Fatecarver (owner 2026-10-10: the old branch A is now the whole card, +6/+6) watches the Growth caster's casts:
    // each cast buffs one living minion of each type, deterministically in board order. RE-PIN: was +2/+2 (branch A).
    const r = simulate(
      [fatecarver, { cardId: 'n2_fatecarver', attack: 4, health: 60, sourceUid: 'FA' },
       { cardId: 'pack', attack: 2, health: 40, sourceUid: 'P' }],
      wall, makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast', 'dragon'] }), combatSide({ tier: 1 }));
    const procs = buffsFrom(r.events, 'm1'); // the branch-A watcher sits in board slot 1
    expect(procs.length, 'branch A never saw the cast').toBeGreaterThan(0);
    expect(procs.every((b) => b.attack === 6 && b.health === 6)).toBe(true);
  });
});
