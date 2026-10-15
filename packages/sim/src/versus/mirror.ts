/**
 * VERSUS — the mirrored view of ONE authoritative fight (promoted out of `sim/balance/seatRunner.ts`, 2026-10-13).
 *
 * The balance bot's self-play table proved the protocol first (`faceOmen { deferFight }` parks a prepared side,
 * ONE `simulate()` runs over two parked sides, both runs land it through `resolveCombat { fight }`). Versus ships
 * that protocol to real players, so the production-safe half lives here: an ordinary module the shipped mode and
 * the server bundle can import, never a balance-only subpath. `seatRunner.ts` re-exports it unchanged.
 *
 * Imports only `@game/core` TYPES: this file rides the Edge Function bundle (`npm run versus:bundle`).
 */
import type { CombatResult } from '@game/core';

/**
 * The `enemy` seat's view of the one authoritative result.
 *
 * B1 found the simulator's carry-backs were player-only (~45 `player*` fields, 74 `side === 'player'` gates,
 * enemy Deathrattles not even counted) — the largest production discrepancy on the roadmap. `simulate` now
 * computes the SAME carry-backs for both sides and reports the enemy's on `CombatResult.enemyCarry`
 * (core `CombatCarryBacks`, 2026-09-15); this mirror lifts that object onto the `player*` fields the real
 * `resolveCombat` path reads, so the `enemy` seat settles with everything it earned: Engraved gains,
 * Kennelmaster / Sergeant / Guel / Tara progress, hand grants, Reinvestment, quest tallies, ….
 *
 * THE MAPPING IS EXPLICIT, FIELD BY FIELD, in both directions: every `player*` field on the mirrored result is
 * written from `enemyCarry` and nothing else (the fight's own `player*` fields — the OTHER seat's earnings —
 * are stripped first, so a new `player*` field can never leak across the table by default, and a new
 * `CombatCarryBacks` field is silently dropped here until it is mapped — the leak test names the contract).
 *
 * Since R-SYMMETRY-01 (2026-10-13) the simulator has NO kept asymmetries: the enemy half is the same live
 * computation (Pack Mentality grows, Blood Trail marks, Grim / spell power / Imp Aura / per-card stacks are live),
 * so every carry-back below is the seat's real one. The event log keeps the fight's own labels (it is ONE fight,
 * shared by both seats; `initial` is swapped so the seat's own board reads as `player`). A result without
 * `enemyCarry` (a hand-built fixture) mirrors damage, outcome, deaths and survivors only — deathrattles recorded
 * as 0, never estimated.
 */
export function mirrorForEnemySeat(result: CombatResult): CombatResult {
  const clone = structuredClone(result);
  // Strip EVERY player-perspective carry-back: they belong to the other seat.
  for (const key of Object.keys(clone) as (keyof CombatResult)[]) {
    if (key.startsWith('player')) delete clone[key];
  }
  delete clone.damageBreakdown;
  delete clone.enemyDamageBreakdown;
  delete clone.enemyScalers;
  delete clone.oddsInput;
  delete clone.enemyCarry; // consumed here — the mirrored view must not carry the other seat's mirror of it
  const outcome = result.result === 'win' ? 'lose' : result.result === 'lose' ? 'win' : 'draw';
  const c = result.enemyCarry;
  const survivors = c ? (c.survivorCardIds ?? []) : enemySurvivorCardIds(result);
  const defined = <T extends object>(o: T): Partial<T> =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
  const carried: Partial<CombatResult> = c ? defined({
    playerDeathrattles: c.deathrattles,
    playerRallies: c.rallies,
    playerShoutFires: c.shoutFires,
    playerShoutMeters: c.shoutMeters,
    playerImpsSummoned: c.impsSummoned,
    playerFirstKill: c.firstKill,
    playerLastKill: c.lastKill,
    playerQuestTally: c.questTally,
    playerQuestEvents: c.questEvents,
    playerBeastBuyAtkGain: c.beastBuyAtkGain,
    playerBeastBuyHpGain: c.beastBuyHpGain,
    playerBeastScaleProgress: c.beastScaleProgress,
    playerSummonBonus: c.summonBonus,
    playerHpGrantBonus: c.hpGrantBonus,
    playerSpellProgress: c.spellProgress,
    playerDamageMeters: c.damageMeters,
    playerAscendCount: c.ascendCount,
    playerPermaBuffs: c.permaBuffs,
    playerHandGrants: c.handGrants,
    playerHandBuffs: c.handBuffs,
    playerRubyGrants: c.rubyGrants,
    playerRubyGrantIds: c.rubyGrantIds,
    playerNextTurnSpellCopies: c.nextTurnSpellCopies,
    playerRubyBonusGain: c.rubyBonusGain,
    playerRubyMints: c.rubyMints,
    playerHandSummoned: c.handSummoned,
    playerBeastExtraGain: c.beastExtraGain,
    playerTavernBuyGain: c.tavernBuyGain,
    playerTavernBuyGainSources: c.tavernBuyGainSources,
    playerWildHuntGrown: c.wildHuntGrown,
    playerSpellPower: c.spellPower,
    playerCardBuffs: c.cardBuffs,
    playerFodderGrants: c.fodderGrants,
    playerFodderSchedule: c.fodderSchedule,
    playerDeferredBattlecries: c.deferredBattlecries,
    playerShoutCarry: c.shoutCarry,
    playerMaxGoldGain: c.maxGoldGain,
    playerBonusGold: c.bonusGold,
    playerFreeRolls: c.freeRolls,
    playerGuaranteedAttachments: c.guaranteedAttachments,
    playerSpellsCast: c.spellsCast,
    playerSpellEscalationGain: c.spellEscalationGain,
    playerDiscoverCasts: c.discoverCasts,
    playerNextShopBuff: c.nextShopBuff,
    playerUndeadBuyAtkGain: c.undeadBuyAtkGain,
    playerSlaughterCopy: c.slaughterCopy,
    playerUndeadAuraGain: c.undeadAuraGain,
    playerStarformGain: c.starformGain,
    playerImpBuffGain: c.impBuffGain,
    playerHoardGain: c.hoardGain,
    playerRightmostSlotBuff: c.rightmostSlotBuff,
    playerBeastialSwarmLevel: c.beastialSwarmLevel,
    playerPackcraftLevel: c.packcraftLevel,
    playerBoardBuffGain: c.boardBuffGain,
    playerMagneticBuffGain: c.magneticBuffGain,
    playerFodderBuffGain: c.fodderBuffGain,
    // The hero (Ancient) channels — either seat's hero rides its own fight since R-SYMMETRY-01.
    playerWardBreaks: c.wardBreaks,
    playerWardWindow: c.wardWindow,
    playerRises: c.rises,
    playerSummonsMade: c.summonsMade,
    playerAncientPummelDealt: c.ancientPummelDealt,
    playerAncientSpellImproved: c.ancientSpellImproved,
    playerAncientClearanceStacks: c.ancientClearanceStacks,
    playerAncientMaxGoldFires: c.ancientMaxGoldFires,
  }) : { playerDeathrattles: 0 }; // UNKNOWN without the symmetric surface — recorded as 0, never estimated
  return {
    ...clone,
    result: outcome,
    playerDamage: result.enemyDamage ?? 0,
    enemyDamage: result.playerDamage,
    // The itemized blows swap sides with the damage they explain.
    ...(result.enemyDamageBreakdown ? { damageBreakdown: result.enemyDamageBreakdown } : {}),
    ...(result.damageBreakdown ? { enemyDamageBreakdown: result.damageBreakdown } : {}),
    playerDeaths: c ? c.deaths : result.enemyDeaths,
    enemyDeaths: c ? c.foeDeaths : (result.playerDeaths ?? 0),
    ...(survivors.length ? { playerSurvivorCardIds: survivors } : {}),
    initial: { player: clone.initial.enemy, enemy: clone.initial.player },
    ...carried,
  } as CombatResult;
}

/** The enemy survivors folded from the event log — the fallback for a result without `enemyCarry`. */
function enemySurvivorCardIds(result: CombatResult): string[] {
  const alive = new Map<string, string>(result.initial.enemy.map((m) => [m.uid, m.cardId]));
  for (const e of result.events) {
    if (e.type === 'summon' && e.side === 'enemy') alive.set(e.minion.uid, e.minion.cardId);
    else if (e.type === 'death' && e.side === 'enemy' && !e.rise) alive.delete(e.target);
  }
  return [...alive.values()];
}
