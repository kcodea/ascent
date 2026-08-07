import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult, type QuestCombatMods } from '../index';

/**
 * THE combat spell-cast path (`castInCombat`) and Runebloom Matriarch's rework (owner 2026-08-07).
 *
 * Before the unification, eight factories each hand-rolled "decide reps → castSpell → apply", which is why
 * "your Shop Spells cast an extra time in combat" had nowhere to hook. These tests pin the two properties the
 * unification exists to give: a grant of extra casts reaches every caster through one path, and it multiplies
 * GENUINE CASTS — so the in-combat spell watchers fire per cast — rather than doubling one cast's magnitude.
 *
 * Built on real cards rather than fixtures: Fatecarver branch B casts a Growth on every friendly attack, and
 * Thunderous Sovereign accrues one stack per cast, which makes it a clean cast COUNTER.
 */
const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 90000 }];
/** Fatecarver locked to branch B (option 1): every friendly attack casts a Growth. */
const fatecarver: BoardMinion = { cardId: 'n2_fatecarver', attack: 4, health: 900, sourceUid: 'FC', chosenOption: 1 };
/** Thunderous Sovereign gains a stack per cast — its carried-back bonus IS the cast count. */
const sovereign: BoardMinion = { cardId: 'd2_sovereign', attack: 8, health: 900, sourceUid: 'TS' };

function fight(extra: BoardMinion[], mods?: Partial<QuestCombatMods>): CombatResult {
  return simulate(
    [fatecarver, sovereign, ...extra],
    wall, makeRng(3), CARD_INDEX,
    // Spread CONDITIONALLY: passing `questMods: undefined` overrides combatSide's own default and blows up
    // the aura read, rather than meaning "no mods".
    combatSide({ tier: 6, tribes: ['beast', 'dragon'], ...(mods ? { questMods: mods as QuestCombatMods } : {}) }),
    combatSide({ tier: 1 }),
  );
}

/** How many spells resolved on the player's side this fight. */
const castCount = (r: CombatResult): number => (r.playerSpellsCast ?? 0);
/** Friendly swings. Fatecarver branch B casts exactly one Growth per friendly attack, so this is the number
 *  of cast OPPORTUNITIES — and casts / opportunities is the repetition count, exactly. */
const playerAttacks = (r: CombatResult): number => {
  const own = new Set(r.initial.player.map((m) => m.uid));
  for (const e of r.events) if (e.type === 'summon' && e.side === 'player') own.add(e.minion.uid);
  return r.events.filter((e: CombatEvent) => e.type === 'attack' && own.has(e.attacker)).length;
};
/** THE measurement. An end-to-end fight cannot give exact multiples — the extra casts buff the board, which
 *  changes how long the fight runs — so comparing raw totals between two fights is the wrong instrument.
 *  Casts per opportunity is stable at any length. It is not perfectly integral (the last swing or two can
 *  land as combat ends, with no cast resolving after), so round it and assert the rounding was not a stretch. */
const repsPerCast = (r: CombatResult): number => {
  const raw = castCount(r) / playerAttacks(r);
  expect(Math.abs(raw - Math.round(raw)), `casts/attack = ${raw} is not near an integer`).toBeLessThan(0.1);
  return Math.round(raw);
};

const MATRIARCH: BoardMinion = { cardId: 'b2_runebloom', attack: 8, health: 900, sourceUid: 'RB' };
/** The CONTROL. Adding the Matriarch adds a BODY, and a body changes the fight — more attackers means more
 *  Fatecarver Growth triggers and a different length. So the baseline board carries an effect-less minion of
 *  the identical stat line in the same slot; only the grant differs between the two fights. */
const FILLER: BoardMinion = { cardId: 'sandbag', attack: 8, health: 900, sourceUid: 'RB' };

describe('castInCombat — the single combat spell-cast path', () => {
  it('a Runebloom Matriarch on board makes each Shop Spell resolve an extra time', () => {
    const plain = fight([FILLER]);
    const withMatriarch = fight([MATRIARCH]);
    expect(castCount(plain), 'no casts at all — the fixture is wrong').toBeGreaterThan(0);
    expect(repsPerCast(plain)).toBe(1);
    expect(repsPerCast(withMatriarch)).toBe(2);
  });

  it('the extra is a genuine EXTRA CAST, not one doubled cast', () => {
    // THE property the unification exists to give. A "just double the numbers" implementation would inflate
    // each Growth's magnitude and leave the cast count flat. The discriminator is checkable INSIDE one fight,
    // with no cross-fight arithmetic: every Growth event still lands at its own printed magnitude, unchanged
    // by the grant, while the number of casts per opportunity doubles.
    const magnitudes = (r: CombatResult): Set<string> => new Set(
      r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === 'm0')
        .map((e) => `${e.attack}/${e.health}`));
    const plain = fight([FILLER]);
    const withMatriarch = fight([MATRIARCH]);
    expect(magnitudes(withMatriarch)).toEqual(magnitudes(plain)); // same spell, same size
    expect(repsPerCast(withMatriarch)).toBe(repsPerCast(plain) * 2); // twice as often
  });

  it('every in-combat spell WATCHER sees the extra casts too', () => {
    // Thunderous Sovereign accrues per cast. Its carry-back must GROW when the casts do — that is what
    // "one path reaches every caster and every watcher" means. The rate per cast is not compared across the
    // two fights on purpose: the boards differ, so the fights differ, and only the direction is meaningful.
    const bonusOf = (r: CombatResult): number => (r.playerSummonBonus ?? []).find((b) => b.sourceUid === 'TS')?.bonus ?? 0;
    const plain = fight([FILLER]);
    const withMatriarch = fight([MATRIARCH]);
    expect(bonusOf(plain)).toBeGreaterThan(0);
    expect(bonusOf(withMatriarch)).toBeGreaterThan(bonusOf(plain));
  });

  it('Rune of the Matriarch doubles the grant — "triggers twice" is two extra casts', () => {
    expect(repsPerCast(fight([MATRIARCH]))).toBe(2);
    expect(repsPerCast(fight([MATRIARCH], { runeMatriarch: true }))).toBe(3);
  });

  it('a GOLDEN Matriarch grants two extra casts', () => {
    expect(repsPerCast(fight([{ ...MATRIARCH, golden: true }]))).toBe(3);
  });

  it('does nothing without a granter, and announces itself exactly once with one', () => {
    const grantNotes = (r: CombatResult) => r.events
      .filter((e): e is Extract<CombatEvent, { type: 'sc' }> => e.type === 'sc' && /Shop Spells cast/.test(e.text));
    expect(grantNotes(fight([FILLER])).length).toBe(0);
    const notes = grantNotes(fight([MATRIARCH]));
    expect(notes.length).toBe(1);
    expect(notes[0]!.text).toContain('1 extra time');
  });
});
