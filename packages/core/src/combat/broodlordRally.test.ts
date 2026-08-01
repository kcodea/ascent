import { describe, it, expect } from 'vitest';
import { combatSide, simulate, makeRng, type BoardMinion } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * Ashen Broodlord (owner rework 2026-07-31): **Rally: cast a Staff of Guel.**
 *
 * Three properties make this a *cast* rather than a buff, and each has bitten a near-copy before (see the
 * comment on `onAllyAttackCastGrowth`, whose first duplicate missed both the spell-power scaling and
 * `ctx.castSpell`):
 *   1. the tavern buff is PERMANENT — it carries out of combat via `playerTavernBuyGain`;
 *   2. it scales with the run's spell power, like any Staff cast in the shop;
 *   3. it is a real spell cast, so per-spell payoffs (Guel, Groveweaver) see it.
 */
const wall: BoardMinion[] = [{ cardId: 'drummer', attack: 0, health: 400 }];
// The gilded body keeps the PLAIN body's Attack on purpose: a golden minion normally has doubled stats, but
// doubling Attack here would halve the number of swings before the wall dies — and the swing count is what
// produces Rallies. Holding Attack fixed isolates the property under test (casts per Rally), which is the
// only thing gilding is supposed to change.
const fight = (over: Partial<Parameters<typeof combatSide>[0]> = {}, golden = false) =>
  simulate(
    [{ cardId: 'd2_broodlord', attack: 6, health: 40, sourceUid: 'BL', golden }],
    wall, makeRng(4), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['dragon', 'demon'], ...over }), combatSide({ tier: 1 }),
  );

describe('Ashen Broodlord — Rally casts a Staff of Guel', () => {
  it('the Staff buff carries OUT of combat (permanent), at the Staff\'s printed +2/+2', () => {
    const r = fight();
    expect(r.playerTavernBuyGain, 'the Rally never paid a tavern buff').toBeDefined();
    // One Rally per swing; each is a +2/+2 Staff, so the total is a positive multiple of 2.
    expect(r.playerTavernBuyGain!.attack).toBeGreaterThanOrEqual(2);
    expect(r.playerTavernBuyGain!.attack % 2).toBe(0);
    expect(r.playerTavernBuyGain!.attack).toBe(r.playerTavernBuyGain!.health);
  });

  it('it SCALES with the run\'s spell power — the owner\'s "carries any spell buffs"', () => {
    const bare = fight();
    const buffed = fight({ spellPowerAtk: 3, spellPowerHp: 3 });
    expect(buffed.playerTavernBuyGain!.attack, 'spell power did not fold into the cast')
      .toBeGreaterThan(bare.playerTavernBuyGain!.attack);
  });

  it('it is a REAL spell cast — the run\'s spellsCast tally moves', () => {
    const r = fight();
    expect(r.playerSpellsCast ?? 0, 'the Staff cast was not counted as a spell cast').toBeGreaterThan(0);
  });

  it('GILDED casts twice — double the buff AND double the casts', () => {
    const plain = fight();
    const gilded = fight({}, true);
    // Attack is held equal (see the fixture note), so both sides swing the same number of times and the
    // gilded total is exactly twice — one extra cast per Rally, not a bigger one.
    expect(gilded.playerTavernBuyGain!.attack).toBe(plain.playerTavernBuyGain!.attack * 2);
    expect(gilded.playerSpellsCast).toBe((plain.playerSpellsCast ?? 0) * 2);
  });
});
