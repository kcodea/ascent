import { combatSide, type CombatSideState } from '@game/core';
import type { BoardSnapshot } from './snapshot';

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
export function sideFromSnapshot(snap: BoardSnapshot, fallbackTier: number, poolIds: string[]): CombatSideState {
  return combatSide({
    tier: snap.tier ?? fallbackTier,
    poolIds,
    spellPowerAtk: snap.spellPower?.attack ?? 0,
    spellPowerHp: snap.spellPower?.health ?? 0,
    spellsThisTurn: snap.spellsThisTurn ?? 0,
    beastsPlayed: snap.beastsPlayed ?? 0,
    deathrattles: snap.deathrattles ?? 0,
    spellsCast: snap.spellsCast ?? 0, // enemy Umbral Energy
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
    questMods: snap.questMods ?? {}, // enemy runes/quests reproduced in combat
    // The 2026-08-06 audit closed eight dropped scalers (owner report: a served Gemstorm played 1/1 Rubies
    // because the board's +16/+16 rubyBonus never travelled). `snapshotFidelity.test.ts` now diffs this
    // builder against the reducer's own player-side context, so a scaler added there without a snapshot
    // field + a line here fails a test instead of silently weakening every served board.
    rubyBonus: snap.rubyBonus ?? { attack: 0, health: 0 }, // enemy Ruby strength (Gemstorm / Geode / Conduit)
    wildHuntGrown: snap.wildHuntGrown ?? 0, // enemy Rune of the Wild Hunt resumes where it grew to
    cardsBoughtThisTurn: snap.cardsBoughtThisTurn ?? 0, // enemy Frenzied Excavator
    cardBuffs: snap.cardBuffs ?? {}, // enemy run-wide card-type buffs (sizes mid-fight tokens)
    handSpellIds: snap.handSpellIds ?? [], // enemy Vault Curator
    handMinions: snap.handMinions ?? [], // enemy Rope Wrangler / Water Dragon
    beastHuntExtra: snap.beastHuntExtra ?? 0, // enemy Elderhorn (Rally/Slaughter)
    beastRitualExtra: snap.beastRitualExtra ?? 0, // enemy Elderhorn (Echo)
    tribes: snap.tribes ?? [], // captured since v1 but never threaded — tribe-scoped random grants read it
  });
}
