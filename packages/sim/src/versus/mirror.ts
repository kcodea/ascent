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
 * so every carry-back below is the seat's real one. THE WHOLE PERSPECTIVE FLIPS AS ONE (fix 2026-10-14, live bug: "cubs and
 * imps were summoning on the wrong side of the board"): `initial` is swapped so the seat's own board reads as
 * `player`, AND every event's `side` is swapped with it (`flipEventSides`). The old mirror kept the fight's own
 * event labels while swapping `initial`, so a `summon` landed on the other seat's row, and every `side`-keyed read
 * (Avenge death tallies, hand grants, quest pulses, spell counters, the narration's "your / their") read the wrong
 * seat. Events otherwise name bodies by uid, which is perspective-free. A mirrored result is stamped
 * `sidesMirrored: true`, so a reader can tell an old stored one (labels unflipped) from a new one
 * (`ownSeatPerspective`). A result without
 * `enemyCarry` (a hand-built fixture) mirrors damage, outcome, deaths and survivors only — deathrattles recorded
 * as 0, never estimated.
 */
/** Swap every `player` <-> `enemy` string, deeply (the R-SYMMETRY-01 oracle's relabel). Card ids, texts and uids
 *  never equal either word, so only perspective labels move. */
function swapSideLabels<T>(x: T): T {
  if (x === 'player') return 'enemy' as T;
  if (x === 'enemy') return 'player' as T;
  if (Array.isArray(x)) return x.map(swapSideLabels) as T;
  if (x && typeof x === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) out[k] = swapSideLabels(v);
    return out as T;
  }
  return x;
}

/**
 * Relabel every event to the other seat's perspective: every `player` / `enemy` value anywhere in an event (today
 * that is `side`; a future side-bearing field flips with it, by construction). Bodies are named by uid, which is
 * perspective-free, and a `summon`'s `index` is a slot within its own side's row, so it stays valid. Never mutates.
 */
export function flipEventSides(events: CombatResult['events']): CombatResult['events'] {
  return swapSideLabels(events).map((e) => {
    // The one narration worded per seat (R-SYMMETRY-01's exception): the simulator words it from the player chair.
    const t = (e as { text?: unknown }).text;
    if (typeof t !== 'string') return e;
    const swapped = t.startsWith(VIGOR_OURS) ? VIGOR_THEIRS + t.slice(VIGOR_OURS.length) : t.startsWith(VIGOR_THEIRS) ? VIGOR_OURS + t.slice(VIGOR_THEIRS.length) : t;
    return swapped === t ? e : ({ ...e, text: swapped } as typeof e);
  });
}
const VIGOR_OURS = 'Fleeting Vigor — your minions surge';
const VIGOR_THEIRS = 'Fleeting Vigor: their minions surge';

/**
 * The p2 seat's result in its OWN perspective, whatever produced it: a result from the fixed mirror (stamped
 * `sidesMirrored`) as it is; one stored by the old mirror (the `initial` boards swapped, the event labels not) gets
 * its event sides flipped here, once. Readers of a stored p2 result call this; a p1 result is never mirrored.
 */
export function ownSeatPerspective(result: CombatResult): CombatResult {
  if (!result || result.sidesMirrored || !Array.isArray(result.events)) return result;
  return { ...result, events: flipEventSides(result.events), sidesMirrored: true };
}

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
    events: flipEventSides(clone.events),
    sidesMirrored: true,
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
