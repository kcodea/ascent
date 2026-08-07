import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult } from '../index';

/**
 * QUIL (owner addition 2026-08-07) — Start of Combat: cast the left-most spell in your hand on adjacent Beasts.
 *
 * Two owner rulings are pinned here:
 *  1. The spell is NOT consumed, so Quil re-casts it every fight.
 *  2. For a self-improving spell (Front to Back), the STATS the cast hands out are temporary like any combat
 *     buff, but the SPELL keeps the improvement — it carries back to the run.
 */
const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 40000 }];

/** Quil flanked by two Beasts, with `spells` as the hand snapshot (left-most first). */
function fight(spells: string[], opts: { golden?: boolean; escalation?: { attack: number; health: number } } = {}): CombatResult {
  return simulate(
    [
      { cardId: 'stray', attack: 1, health: 400, sourceUid: 'L' },
      { cardId: 'b2_quil', attack: 7, health: 400, sourceUid: 'Q', golden: opts.golden },
      { cardId: 'stray', attack: 1, health: 400, sourceUid: 'R' },
    ],
    wall, makeRng(5), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['beast'], handSpellIds: spells, ...(opts.escalation ? { spellEscalation: opts.escalation } : {}) }),
    combatSide({ tier: 1 }),
  );
}

/** Buffs Quil handed out (its combat uid is board slot 1). */
const quilBuffs = (r: CombatResult) =>
  r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === 'm1');

describe('Quil — Start of Combat, cast the left-most held spell on adjacent Beasts', () => {
  it('casts the LEFT-MOST spell, not any other one in hand', () => {
    // Growth is +1/+1; Spirit Fire is +2/+3. Putting Growth first must produce Growth's numbers.
    const r = fight(['growth', 'spiritfire']);
    const buffs = quilBuffs(r);
    expect(buffs.length, 'Quil never cast').toBeGreaterThan(0);
    expect(buffs.every((b) => b.attack === 1 && b.health === 1), 'cast the wrong spell').toBe(true);
  });

  it('hits BOTH adjacent Beasts and nothing else', () => {
    const r = fight(['growth']);
    const targets = new Set(quilBuffs(r).map((b) => b.target));
    expect(targets).toEqual(new Set(['m0', 'm2'])); // its two neighbours, not itself, not the far board
  });

  it('does nothing with an empty hand, or a hand whose left-most spell is tavern-only', () => {
    expect(quilBuffs(fight([])).length).toBe(0);
    // Spell Cart refreshes the tavern into spells — no combat meaning, so a silent fizzle by the ruling.
    expect(quilBuffs(fight(['spellcart'])).length).toBe(0);
  });

  it('is a REAL cast — it counts, so in-combat spell payoffs see it', () => {
    expect(fight(['growth']).playerSpellsCast ?? 0).toBeGreaterThan(0);
  });

  it('a GOLDEN Quil casts twice', () => {
    const plain = quilBuffs(fight(['growth'])).length;
    const golden = quilBuffs(fight(['growth'], { golden: true })).length;
    expect(golden).toBe(plain * 2);
  });

  describe('Front to Back — the stats are temporary, the SPELL keeps its improvement', () => {
    it('grants the escalated value the run has already accumulated', () => {
      // Front to Back is +2/+2 base. With +4/+4 already banked, a cast must grant +6/+6 — what a hand cast
      // would grant right now — rather than the printed base.
      const r = fight(['fronttoback'], { escalation: { attack: 4, health: 4 } });
      const buffs = quilBuffs(r);
      expect(buffs.length).toBeGreaterThan(0);
      expect(buffs.every((b) => b.attack === 6 && b.health === 6)).toBe(true);
    });

    it('carries the improvement back to the run — the spell learned, even though the stats did not stick', () => {
      const r = fight(['fronttoback']);
      expect(r.playerSpellEscalationGain, 'the cast taught the spell nothing').toEqual({ attack: 2, health: 2 });
    });

    it('a non-escalating spell carries nothing back', () => {
      expect(fight(['growth']).playerSpellEscalationGain).toBeUndefined();
    });

    it('a GOLDEN Quil improves the spell twice, and the second cast already grants the improved value', () => {
      const r = fight(['fronttoback'], { golden: true });
      expect(r.playerSpellEscalationGain).toEqual({ attack: 4, health: 4 }); // two casts, +2/+2 each
      // The improvement is live for the rest of the fight, so the two casts differ: +2/+2 then +4/+4.
      const sizes = quilBuffs(r).map((b) => `${b.attack}/${b.health}`);
      expect(new Set(sizes)).toEqual(new Set(['2/2', '4/4']));
    });
  });
});
