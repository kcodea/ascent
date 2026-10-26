/**
 * VERSUS HEALTH AND ARMOR (owner 2026-10-26: "I want to move the normal lobby mode health/damage system to versus so
 * the experience is the same"; R-VERSUS-HEALTH-01, R-DUOS-HEALTH-01). Hearts are gone from every Versus mode:
 *
 *  - Each player starts on their hero's own Health and Armor, exactly as a lobby seat does (`HeroDef.resolve` /
 *    `armor`). A Summit room adds the rift's +10 Armor again (R-VERSUS-SUMMIT-01, reversed 2026-10-26).
 *  - A lost fight costs the lobby's damage: the striking side's tavern tier plus each surviving minion's tier, read off
 *    the ONE authoritative `simulate()` result, capped by the lobby's round cap (`lossDamageCap`). Armor absorbs
 *    first. A draw costs nobody. Health 0 is out.
 *  - DUOS: the team shares ONE pool, "30 hp plus the sum of both armors" (owner) (+10 Armor per hero with Summit).
 *    The losing team takes the lobby damage of the board that ENDED the fight on the winning side (its own tavern
 *    tier + its survivors' tiers): `simulate()` already swaps the side's run context when a reserve steps in, so its
 *    `playerDamage` / `enemyDamage` is exactly that, and it is the board whose minions are still standing.
 *
 * THE POOL IS THE SERVER'S. The resolver stores every seat's (Duos: team's) Health and Armor after each round and
 * charges the next round from those. The one thing it cannot see is a shop effect that raises a pool: today only
 * Mend's "Set your Armor to 5" (`setArmor`). So each locked side reports its run's pools (`PreparedCombatSide.vitals`)
 * and a FRESH report (locked or promoted at the deadline this round, never an auto-played old board) may raise the
 * stored Armor up to the content's highest Armor floor, never past it, and never raises Health (no card heals the hero;
 * a future one must teach `versusVitalsBefore`). The same rule as the lobby's "the run's pools are authoritative going
 * into the hit" (owner report 2026-09-10, "Mend's Armor falls off after a turn"), bounded because the server does not
 * trust a client to be immortal.
 *
 * Bundle-safe: content data + pure siblings + hero/rift DATA modules only (rides `versus-resolve`).
 */
import { CARD_INDEX } from '@game/content';
import type { CombatResult } from '@game/core';
import { RIFT_BONUS_ARMOR } from '../config';
import { getHero } from '../heroes';
import { lossDamageCap } from '../lossCap';
import { normalizeVersusOptions, versusOptionsRift, type VersusRoomOptions } from './options';

/** A seat's (Duos: a team's) Health and Armor. */
export interface VersusVitals {
  health: number;
  armor: number;
}

/** A Duos team's shared Health (owner 2026-10-26: "The duo gets 30 hp plus the sum of both armors"). */
export const VERSUS_DUOS_TEAM_HEALTH = 30;

/** The Armor a room's modifier adds to EVERY hero (Summit: +10, as the lobby's Summit rift). */
export function versusModifierArmor(options?: VersusRoomOptions | null | unknown): number {
  const rift = versusOptionsRift(normalizeVersusOptions(options));
  return rift ? RIFT_BONUS_ARMOR[rift] ?? 0 : 0;
}

/** A seat's starting pools: its hero's own Health and Armor, plus the modifier's Armor. */
export function versusStartingVitals(heroId: string | null | undefined, options?: VersusRoomOptions | null | unknown): VersusVitals {
  const hero = getHero(heroId ?? undefined);
  return { health: hero.resolve, armor: hero.armor + versusModifierArmor(options) };
}

/** A Duos team's starting pool: 30 Health, both heroes' Armor (each hero's modifier Armor included). */
export function versusDuosStartingVitals(
  heroA: string | null | undefined,
  heroB: string | null | undefined,
  options?: VersusRoomOptions | null | unknown,
): VersusVitals {
  const bonus = versusModifierArmor(options);
  return { health: VERSUS_DUOS_TEAM_HEALTH, armor: getHero(heroA ?? undefined).armor + getHero(heroB ?? undefined).armor + 2 * bonus };
}

/** The round's loss cap: the lobby's own table (Infinity = uncapped). */
export const versusRoundCap = (round: number): number => lossDamageCap(round);

let armorFloorMax: number | null = null;
/** The highest Armor any card SETS (Mend: 5): the most a fresh report may raise a pool's stored Armor to. */
export function versusArmorFloorMax(): number {
  if (armorFloorMax != null) return armorFloorMax;
  let max = 0;
  for (const def of Object.values(CARD_INDEX)) {
    for (const e of def.effects ?? []) {
      if (e.do !== 'setArmor') continue;
      const amount = (e.params as { amount?: unknown } | undefined)?.amount;
      max = Math.max(max, typeof amount === 'number' && Number.isFinite(amount) ? amount : 5);
    }
  }
  armorFloorMax = max;
  return max;
}

const whole = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null);

/** A side's reported pools, when it carries a well-formed report. */
export function reportedVitals(side: unknown): VersusVitals | null {
  const v = (side as { vitals?: { resolve?: unknown; armor?: unknown } } | null | undefined)?.vitals;
  if (!v || typeof v !== 'object') return null;
  const health = whole(v.resolve);
  const armor = whole(v.armor);
  return health == null || armor == null ? null : { health, armor };
}

/**
 * The pools a seat (or team) fights a round with: the stored ones, with Armor raised by the FRESH reports (Mend), each
 * bounded by the content's highest Armor floor. `reports` are only the fresh sides' (see `versusFreshSide`).
 */
export function versusVitalsBefore(stored: VersusVitals, reports: readonly (VersusVitals | null)[]): VersusVitals {
  let armor = stored.armor;
  const ceiling = Math.max(stored.armor, versusArmorFloorMax());
  for (const r of reports) if (r && r.armor > armor) armor = Math.min(r.armor, ceiling);
  return { health: Math.max(0, stored.health), armor: Math.max(0, armor) };
}

/** Charge `damage` to a pool: Armor first, then Health (never below 0). The lobby's `hitSeat` order. */
export function hitVitals(before: VersusVitals, damage: number): VersusVitals {
  const left = Math.max(0, damage);
  const fromArmor = Math.min(before.armor, left);
  return { health: Math.max(0, before.health - (left - fromArmor)), armor: before.armor - fromArmor };
}

/** Health + Armor (the lobby's "HP" for the wipeout tiebreak). */
export const vitalsTotal = (v: VersusVitals): number => v.health + v.armor;

/**
 * Stamp ONE seat's view of a fight with the lobby's cap, exactly as the run loop stamps a lobby fight (`faceOmen`):
 * `playerDamageUncapped` (on a loss), `damageCap` (when capped), `playerDamage` capped, and `enemyDamage` capped the
 * same way (the blow this seat landed). `after` is the seat's (team's) pools once the round settled. Returns a new
 * object; the input is never mutated.
 */
export function stampVersusDamage(view: CombatResult, cap: number, after?: VersusVitals | null): CombatResult {
  const out: CombatResult = { ...view };
  const raw = view.playerDamage;
  if (view.result === 'lose') out.playerDamageUncapped = raw;
  if (Number.isFinite(cap)) out.damageCap = cap;
  out.playerDamage = Math.min(raw, cap);
  if (view.enemyDamage != null) out.enemyDamage = Math.min(view.enemyDamage, cap);
  if (after) out.versusVitals = { health: after.health, armor: after.armor };
  return out;
}

/**
 * A stored final side as the resolver may read its pools: a side that was not locked or promoted THIS round (an
 * auto-played old board, or the empty side) carries a stale report, so it is dropped. Used by the Edge Function's
 * store; the pure handlers then treat any report they see as fresh.
 */
export function versusFreshSide(side: unknown, source: string | null | undefined): unknown {
  if (!side || typeof side !== 'object') return side;
  if (source === 'lock' || source === 'deadline') return side;
  if (!('vitals' in (side as object))) return side;
  const { vitals: _stale, ...rest } = side as Record<string, unknown>;
  return rest;
}
