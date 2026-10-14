import { describe, it, expect } from 'vitest';
import { combatSide, simulate, makeRng, type BoardMinion, type CombatCarryBacks, type CombatResult } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * SYMMETRIC CARRY-BACKS (balance bot, 2026-09-15). `simulate` computes the settle-time carry-backs for BOTH
 * sides with one code path: the player's half lands on the legacy `player*` fields, the enemy's on
 * `enemyCarry`. These tests pin (1) the mirror — a board's carry-backs are the same whichever side it fights
 * on, (2) the enemy half runs the SAME live machinery (events side-tagged, payouts on `enemyCarry`), and (3) there
 * are no kept asymmetries any more (R-SYMMETRY-01, 2026-10-13; the full mirror lives in sideSymmetry.test.ts).
 */

/** The "earning" board: three Sporelings (Echo: +1/+1 to your minions — each death is a Deathrattle, a
 *  friendly death and an Avenge tick), an Engraved Tara that keeps every +1/+1 (`permaGain`, `ascendCount`), and
 *  Totality (Avenge (3): a Star Crash to hand — a `toHand` grant with no RNG). */
const earners = (): BoardMinion[] => [
  { cardId: 'spore', attack: 2, health: 1, sourceUid: 'S1' },
  { cardId: 'spore', attack: 2, health: 1, sourceUid: 'S2' },
  { cardId: 'spore', attack: 2, health: 1, sourceUid: 'S3' },
  { cardId: 'tara', attack: 4, health: 40, sourceUid: 'TA', keywords: ['EG'] }, // fat, so she outlives every Sporeling
  { cardId: 'ce3_eclipsewarden', attack: 3, health: 60, sourceUid: 'TO' }, // fat, so the Avenge (3) is still alive to fire
];
/** The wall: one fat Taunt, so every swing has exactly one legal target (no target roll to desync the mirror). */
const wall = (): BoardMinion[] => [{ cardId: 'sandbag', attack: 9, health: 60, sourceUid: 'W', keywords: ['T'] }];
const side = () => combatSide({ tier: 4, tribes: ['undead', 'dragon', 'celestial'] });

/** The player's `player*` fields, re-keyed to the side-agnostic `CombatCarryBacks` shape. */
function playerCarry(r: CombatResult): CombatCarryBacks {
  return {
    deathrattles: r.playerDeathrattles, rallies: r.playerRallies, impsSummoned: r.playerImpsSummoned,
    deaths: r.playerDeaths ?? 0, survivorCardIds: r.playerSurvivorCardIds, foeDeaths: r.enemyDeaths,
    firstKill: r.playerFirstKill, lastKill: r.playerLastKill, questTally: r.playerQuestTally, questEvents: r.playerQuestEvents,
    beastBuyAtkGain: r.playerBeastBuyAtkGain, beastBuyHpGain: r.playerBeastBuyHpGain, beastScaleProgress: r.playerBeastScaleProgress,
    summonBonus: r.playerSummonBonus ?? [], hpGrantBonus: r.playerHpGrantBonus, spellProgress: r.playerSpellProgress, damageMeters: r.playerDamageMeters,
    ascendCount: r.playerAscendCount, permaBuffs: r.playerPermaBuffs, handGrants: r.playerHandGrants, handBuffs: r.playerHandBuffs,
    rubyGrants: r.playerRubyGrants, nextTurnSpellCopies: r.playerNextTurnSpellCopies, rubyBonusGain: r.playerRubyBonusGain,
    rubyMints: r.playerRubyMints, handSummoned: r.playerHandSummoned, beastExtraGain: r.playerBeastExtraGain,
    tavernBuyGain: r.playerTavernBuyGain, tavernBuyGainSources: r.playerTavernBuyGainSources, wildHuntGrown: r.playerWildHuntGrown,
    spellPower: r.playerSpellPower, cardBuffs: r.playerCardBuffs, fodderGrants: r.playerFodderGrants, fodderSchedule: r.playerFodderSchedule,
    deferredBattlecries: r.playerDeferredBattlecries, maxGoldGain: r.playerMaxGoldGain, bonusGold: r.playerBonusGold,
    freeRolls: r.playerFreeRolls, guaranteedAttachments: r.playerGuaranteedAttachments, spellsCast: r.playerSpellsCast,
    spellEscalationGain: r.playerSpellEscalationGain, discoverCasts: r.playerDiscoverCasts, nextShopBuff: r.playerNextShopBuff,
    undeadBuyAtkGain: r.playerUndeadBuyAtkGain, slaughterCopy: r.playerSlaughterCopy, undeadAuraGain: r.playerUndeadAuraGain, starformGain: r.playerStarformGain,
    impBuffGain: r.playerImpBuffGain, hoardGain: r.playerHoardGain, rightmostSlotBuff: r.playerRightmostSlotBuff,
    beastialSwarmLevel: r.playerBeastialSwarmLevel, boardBuffGain: r.playerBoardBuffGain, magneticBuffGain: r.playerMagneticBuffGain,
    fodderBuffGain: r.playerFodderBuffGain,
  };
}
/** Drop `undefined` values + the step-tagged timeline (steps differ by side ordering; the tallies are the contract). */
const norm = (c: CombatCarryBacks): Record<string, unknown> =>
  Object.fromEntries(Object.entries(c).filter(([k, v]) => v !== undefined && k !== 'questEvents'));

describe('symmetric combat carry-backs — the enemy seat keeps what it earned', () => {
  it('the earning board reports the SAME carry-backs whether it fights as player or as enemy', () => {
    const asPlayer = simulate(earners(), wall(), makeRng(11), CARD_INDEX, side(), side());
    const asEnemy = simulate(wall(), earners(), makeRng(11), CARD_INDEX, side(), side());
    // Both fights ran the same script (one legal target per swing, no random effect), so the earning side's
    // ledger must be identical — and non-trivial: three Echoes, Tara's kept stats, Totality's Star Crash.
    const mine = playerCarry(asPlayer);
    const theirs = asEnemy.enemyCarry!;
    expect(mine.deathrattles).toBe(3);
    expect(mine.handGrants).toEqual(['starcrash']);
    expect(mine.permaBuffs?.find((b) => b.sourceUid === 'TA')).toMatchObject({ attack: 3, health: 3, engraved: true });
    expect(mine.ascendCount).toEqual([{ sourceUid: 'TA', count: 3 }]);
    expect(norm(theirs)).toEqual(norm(mine));
    // …and the wall's ledger is the mirror of itself too (a side with nothing to carry back reports the same nothing).
    expect(norm(asPlayer.enemyCarry!)).toEqual(norm(playerCarry(asEnemy)));
  });

  it('the mirrored kill / death counters agree with the legacy fields', () => {
    const r = simulate(earners(), wall(), makeRng(11), CARD_INDEX, side(), side());
    expect(r.enemyCarry!.deaths).toBe(r.enemyDeaths);
    expect(r.enemyCarry!.foeDeaths).toBe(r.playerDeaths);
    expect(r.enemyCarry!.firstKill).toBe('spore');
    expect(r.enemyCarry!.lastKill).toBeDefined();
    expect(r.enemyCarry!.survivorCardIds).toEqual(['sandbag']);
  });

  it('the enemy half runs the same machinery: an enemy economy rune pulses its badge (side-tagged) and banks on enemyCarry', () => {
    // The same fight with the enemy carrying an economy rune that pays into RUN state (Soul Taxes: +1 max Gold on
    // Avenge (4)). Since R-SYMMETRY-01 (2026-10-13) the enemy fires it exactly like the player would: its badge
    // pulse is in the log (tagged `enemy`), the payout lands on `enemyCarry`, and nothing about the player changes.
    const bare = simulate(wall(), earners(), makeRng(5), CARD_INDEX, side(), side());
    const withRune = simulate(wall(), earners(), makeRng(5), CARD_INDEX, side(),
      combatSide({ tier: 4, tribes: ['undead', 'dragon', 'celestial'], questMods: { runeSoulTaxes: true } }));
    const pulses = (r: CombatResult) => r.events.filter((e) => e.type === 'questTrigger' && e.flag === 'runeSoulTaxes');
    expect(pulses(bare)).toEqual([]);
    expect(pulses(withRune).length, 'the enemy rune pulses its badge').toBe(1);
    expect(pulses(withRune).every((e) => e.type === 'questTrigger' && e.side === 'enemy')).toBe(true);
    // The fight itself (every non-pulse event, every player field) is unchanged: the rune pays Gold, not stats.
    const fight = (r: CombatResult): string => JSON.stringify(r.events.filter((e) => !(e.type === 'questTrigger' && e.flag === 'runeSoulTaxes')));
    expect(fight(withRune)).toBe(fight(bare));
    expect(bare.enemyCarry!.maxGoldGain).toBeUndefined();
    expect(withRune.enemyCarry!.maxGoldGain, 'the enemy Soul Taxes payout must land on enemyCarry').toBe(1);
  });

  it('a random enemy hand grant comes off a SIDE stream: the fight main stream is untouched, the pick is deterministic and telegraphed', () => {
    // Rune of the Last Call (Avenge (4): two Ales to hand — a random pick). On the second side it must not consume
    // the fight's main RNG (the swings would shift), yet it must still grant, the same seed must grant the same
    // Ales, and (R-SYMMETRY-01) the grant flies to that side's hand in the log, side-tagged, like the player's.
    const mods = { runeLastCall: true };
    const bare = simulate(wall(), earners(), makeRng(9), CARD_INDEX, side(), side());
    const a = simulate(wall(), earners(), makeRng(9), CARD_INDEX, side(), combatSide({ tier: 4, tribes: ['undead', 'dragon', 'celestial'], questMods: mods }));
    const b = simulate(wall(), earners(), makeRng(9), CARD_INDEX, side(), combatSide({ tier: 4, tribes: ['undead', 'dragon', 'celestial'], questMods: mods }));
    const swings = (r: CombatResult): string => JSON.stringify(r.events.filter((e) => e.type === 'attack' || e.type === 'dmg' || e.type === 'death').map((e) => ({ ...e, step: 0 })));
    expect(swings(a)).toBe(swings(bare));
    const ales = (g: readonly string[] | undefined): string[] => (g ?? []).filter((id) => id !== 'starcrash');
    expect(ales(bare.enemyCarry!.handGrants)).toEqual([]);
    expect(ales(a.enemyCarry!.handGrants).length, 'Last Call must grant the enemy its two Ales').toBe(2);
    expect(a.enemyCarry!.handGrants).toEqual(b.enemyCarry!.handGrants);
    const flown = a.events.filter((e) => e.type === 'toHand' && e.side === 'enemy' && e.cardId !== 'starcrash').map((e) => e.type === 'toHand' ? e.cardId : '');
    expect(flown, 'each enemy Ale flies to its hand in the log').toEqual(ales(a.enemyCarry!.handGrants));
    // …while the SAME rune on the player side grants through the fight's own stream, as it always has.
    const p = simulate(earners(), wall(), makeRng(9), CARD_INDEX, combatSide({ tier: 4, tribes: ['undead', 'dragon', 'celestial'], questMods: mods }), side());
    expect(ales(p.playerHandGrants).length).toBe(2);
  });

  it('no kept asymmetries: an enemy Pack Mentality grows, ticks and carries back exactly like the player one', () => {
    // Pack Mentality's live growth used to be player-side machinery (the enemy's progress read as absent). Since
    // R-SYMMETRY-01 the enemy's grows and carries back, and equals the player's for the same board.
    const pack = { beastSummonScale: { per: 1, stepAttack: 1, stepHealth: 1, progress: 0 } };
    const beasts = (): BoardMinion[] => [
      { cardId: 'manasaber', attack: 4, health: 1, sourceUid: 'P1' }, // Echo: two Void Cubs (Beasts) — the summons that tick it
      { cardId: 'manasaber', attack: 4, health: 1, sourceUid: 'P2' },
      { cardId: 'alley', attack: 2, health: 2, sourceUid: 'P3' },
    ];
    const packSide = combatSide({ tier: 4, tribes: ['beast'], questMods: pack });
    const asEnemy = simulate(wall(), beasts(), makeRng(2), CARD_INDEX, side(), packSide);
    const asPlayer = simulate(beasts(), wall(), makeRng(2), CARD_INDEX, combatSide({ tier: 4, tribes: ['beast'], questMods: pack }), side(), { firstSide: 'player' });
    expect(asEnemy.enemyCarry!.beastBuyAtkGain ?? 0, 'the enemy Pack Mentality grew').toBeGreaterThan(0);
    expect(asEnemy.enemyCarry!.beastScaleProgress, 'the enemy progress is tracked').toBe(asPlayer.playerBeastScaleProgress);
    expect(asEnemy.enemyCarry!.beastBuyAtkGain).toBe(asPlayer.playerBeastBuyAtkGain);
    // And the always-present counters are real counts, not placeholders.
    expect(asEnemy.enemyCarry!.deathrattles).toBe(asPlayer.playerDeathrattles);
  });
});
