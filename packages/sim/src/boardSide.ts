import { combatSide, stripNextCombatBanks, stripNextCombatMarks, type BoardMinion, type CombatSideState } from '@game/core';
import { poolFor } from '@game/content';
import type { BoardSnapshot } from './snapshot';

/**
 * Does a snapshot's armed NEXT-COMBAT banks apply in a fight for `fightRound`? (Owner ruling 2026-10-07: "this is
 * probably okay as long as they are spent on the turn the player played them".)
 *
 * A next-combat spell was cast for the fight of the round it was captured at — `snap.wave`. A board re-served in a
 * LATER round is no longer that fight: a recorded seat past its last wave serving its final board (the
 * lobby-stale-final-boards ruling, 2026-09-17), a seat whose recording skipped a wave (`boardAt` serves the last
 * earlier board), a ghost (an eliminated seat's board from the round it died). None of those may cast its banks
 * again. `fightRound` undefined = the caller has no round to compare (a pool board in a non-lobby mode, a tool):
 * the banks apply, exactly as before this ruling.
 */
export function snapshotBanksLive(snap: Pick<BoardSnapshot, 'wave'>, fightRound: number | undefined): boolean {
  return fightRound === undefined || snap.wave === fightRound;
}

/**
 * Build a combat side from a captured board's RUN-LEVEL scalers.
 *
 * Grim / Taragosa / Pack Leader / Runescale / Watcher and friends fight at the value the board's OWNER had, not
 * at ours — so a served board that drops these is materially weaker than the board that was actually played.
 * There is one builder because there are three callers (the served-board path, the lobby path, and the offline
 * board-rating tool), and a scaler added here has to reach all of them or they silently drift apart.
 *
 * `poolIds` is the LIVE run's pinned set, not the snapshot's: a board records which set it was played under, but
 * the fight happens in the current run's, and both sides must draw from one pool.
 */
export function sideFromSnapshot(snap: BoardSnapshot, fallbackTier: number, poolIds: string[], fightRound?: number): CombatSideState {
  // A FRESH mods object per fight, never the snapshot's own (Problem B, 2026-10-07): the snapshot is shared — the
  // lobby's memoized recordings serve one object to every round, and the odds probe re-reads the same side — so
  // nothing a fight does may reach it. (`simulate` also spends its own copy; this is the belt to that brace.) Its
  // next-combat banks are dropped when this fight is not the round they were cast for (`snapshotBanksLive`).
  const mods = snap.questMods ?? {};
  const questMods = snapshotBanksLive(snap, fightRound) ? { ...mods } : stripNextCombatBanks(mods);
  // Pre-emptive Assault is player-only (owner 2026-10-07, R-PREEMPTIVE-PLAYER-01). `snapshotBoard` no longer captures
  // it; this drops it from any board recorded while #1969 still did, so a served board can never carry it.
  delete questMods.attackFirstNext;
  return combatSide({
    tier: snap.tier ?? fallbackTier,
    poolIds,
    spellPowerAtk: snap.spellPower?.attack ?? 0,
    spellPowerHp: snap.spellPower?.health ?? 0,
    spellsThisTurn: snap.spellsThisTurn ?? 0,
    beastsPlayed: snap.beastsPlayed ?? 0,
    deathrattles: snap.deathrattles ?? 0,
    spellsCast: snap.spellsCast ?? 0, // enemy Umbral Energy
    conductorBuff: snap.conductorBuff ?? 0, // enemy Conductor's snowball — its re-fires pay the OWNER's N
    beastBuyAtk: snap.beastBuyAtk ?? 0, // enemy Beast aura
    impAtk: snap.impAura?.attack ?? 0, // enemy Imp Aura → correctly-sized enemy Imp summons
    impHp: snap.impAura?.health ?? 0,
    undeadAtk: snap.undeadAura?.attack ?? 0, // enemy Undead Lantern aura
    undeadHp: snap.undeadAura?.health ?? 0,
    undeadBuyAtk: snap.undeadBuyAtk ?? 0, // enemy Undead buy-time Attack
    magneticAtk: snap.magneticAura?.attack ?? 0, // enemy Attachment aura
    magneticHp: snap.magneticAura?.health ?? 0,
    fodderConsumedAtk: snap.fodderConsumed?.attack ?? 0, // enemy Abhorrent Horror
    fodderConsumedHp: snap.fodderConsumed?.health ?? 0,
    questMods, // enemy runes/quests (+ its next-combat banks on its own round) reproduced in combat
    // The 2026-08-06 audit closed eight dropped scalers (owner report: a served Gemstorm played 1/1 Rubies
    // because the board's +16/+16 rubyBonus never travelled). `snapshotFidelity.test.ts` now diffs this
    // builder against the reducer's own player-side context, so a scaler added there without a snapshot
    // field + a line here fails a test instead of silently weakening every served board.
    rubyBonus: snap.rubyBonus ?? { attack: 0, health: 0 }, // enemy Ruby strength (Gemstorm / Geode / Conduit)
    wildHuntGrown: snap.wildHuntGrown ?? 0, // enemy Rune of the Wild Hunt resumes where it grew to
    cardsBoughtThisTurn: snap.cardsBoughtThisTurn ?? 0, // enemy Frenzied Excavator
    cardBuffs: snap.cardBuffs ?? {}, // enemy run-wide card-type buffs (sizes mid-fight tokens)
    handSpellIds: snap.handSpellIds ?? [], // enemy Vault Curator
    alesLastTurn: snap.alesLastTurn ?? 0, // enemy Bucky
    spellEscalation: snap.spellEscalation ?? { attack: 0, health: 0 }, // enemy Quil casting Front to Back
    lastSpellCastId: snap.lastSpellCastId, // enemy Sporebat's stored spell
    rememberedSpellIds: snap.rememberedSpellIds ?? [], // enemy Runesnout Archivist's journal
    growthBonus: snap.growthBonus ?? 0, // enemy Rune of Living Growth
    goldSpentThisTurn: snap.goldSpentThisTurn ?? 0, // enemy Baby Gastrid re-fired mid-fight (R-REALTIME-03)
    lastSpellThisTurnId: snap.lastSpellThisTurnId, // enemy Recaller re-fired mid-fight
    squirlScoutBuff: snap.squirlScoutBuff ?? 0, // enemy Squirl Scout re-fired mid-fight
    rubyCasts: snap.rubyCasts ?? 0, // enemy Vaultkeeper's spell umbrella (text)
    spiritsPlayed: snap.spiritsPlayed ?? 0, // enemy Kindled Sprite's Rally — was never threaded (a served Sprite fought at 0)
    ...(snap.cardTribes ? { cardTribes: snap.cardTribes } : {}), // Rune of Drakko: a served board's mid-fight summons keep the run's types
    tribesPlayed: snap.tribesPlayed ?? {}, // the per-tribe channel (enemy Bicycle Bob); a legacy capture's Beast/Spirit scalars are folded in by combatSide()
    revelerX: snap.revelerX ?? 0, // enemy Revelers / Luminary (text)
    handMinions: snap.handMinions ?? [], // enemy Rope Wrangler / Water Dragon
    beastHuntExtra: snap.beastHuntExtra ?? 0, // enemy Elderhorn (Rally/Slaughter)
    beastRitualExtra: snap.beastRitualExtra ?? 0, // enemy Elderhorn (Echo)
    tribes: snap.tribes ?? [], // captured since v1 but never threaded — tribe-scoped random grants read it
  });
}

/**
 * A seat's board + side for a fight in `round` — THE builder for every non-player seat fight (owner ruling
 * 2026-10-07 on seat-vs-seat fights getting bare sides: "is a significant issue that needs to be fixed"). A board
 * with a snapshot fights through `sideFromSnapshot`, the same builder the player's opponent uses, so its runes,
 * quests, scalers and banked spells all apply; its one-combat spell MARKS (Bloodlust, Parting Cry, Closed Casket)
 * are stripped like its banks when the board is re-served past its own round. A hand-built board with no snapshot
 * (tests, an authored seat with no runes) keeps the tier-only side it always had.
 */
export function seatCombatSide(
  board: { minions: readonly BoardMinion[]; tier: number; snapshot?: BoardSnapshot },
  round: number,
  /** The set pool the fight draws its random picks from. Omitted (the headless prototype lobby, which has no
   *  pinned set): a snapshot board draws from ITS OWN set's pool, and a snapshot-less board keeps the bare
   *  tier-only side it always had. */
  poolIds?: string[],
): { minions: BoardMinion[]; state: CombatSideState } {
  const snap = board.snapshot;
  if (!snap) return { minions: board.minions.map((m) => ({ ...m })), state: combatSide({ tier: board.tier, ...(poolIds ? { poolIds } : {}) }) };
  const live = snapshotBanksLive(snap, round);
  return {
    minions: live ? board.minions.map((m) => ({ ...m })) : stripNextCombatMarks(board.minions),
    state: sideFromSnapshot(snap, board.tier, poolIds ?? poolFor(snap.setId ?? 'set1').all.map((c) => c.id), round),
  };
}
