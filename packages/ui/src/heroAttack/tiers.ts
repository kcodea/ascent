/**
 * THE DAMAGE TIERS every hero attack escalates by (shared by every style since 2026-09-28). The numbers each attack opens
 * with are the shared damage formation (`formationConfig.ts`).
 *
 * Tiers follow the engine's per-round loss caps of 5 / 10 / 15 / 20: I 1-5, II 6-11, III 12-19, IV 20+. APPROVED by
 * the owner 2026-09-28 for Blast ("those are good thresholds, this blast animation looks good!") and carried to Quake
 * by the ask that made it ("same attack dmg threshold logic as blast"). Each style's tuner can move them in DEV
 * only; production plays these defaults, so every style steps up on exactly the same blow.
 */
import { clamp } from './easing';

export const TIERS = [1, 2, 3, 4] as const;
export type TierNum = (typeof TIERS)[number];

export interface TierThresholds { tier2At: number; tier3At: number; tier4At: number }

/** The shipped (owner-approved) thresholds. */
export const HERO_ATTACK_TIER_THRESHOLDS: Readonly<TierThresholds> = Object.freeze({ tier2At: 6, tier3At: 12, tier4At: 20 });

/** The damage tier of a blow (1..4), from the thresholds. */
export function tierOf(total: number, c: TierThresholds = HERO_ATTACK_TIER_THRESHOLDS): TierNum {
  if (total >= c.tier4At) return 4;
  if (total >= c.tier3At) return 3;
  if (total >= c.tier2At) return 2;
  return 1;
}

/**
 * What a blow's tier depends on besides its damage (every style's plan input carries these).
 *
 * `knockout`: the blow ELIMINATES the struck player (their Resolve + Armor, going in, is at or under the blow the
 * engine decided; see `heroStrikeKnockout` in `../heroBlast/heroStrikeDamage.ts`). Owner ask 2026-09-29: "if a
 * player knocks someone out, it always plays the huge animation".
 */
export interface AttackTierContext { knockout?: boolean }

/** A knockout always plays Tier IV ("Huge"), whatever the number. */
export const KNOCKOUT_TIER: TierNum = 4;

/**
 * THE TIER EVERY HERO ATTACK PLAYS (every style and the damage formation read their tier here, so a new style gets
 * the knockout rule by calling this instead of `tierOf`). Presentation only: the damage shown and the consequence
 * are unchanged; only which version of the attack plays.
 */
export function attackTier(total: number, ctx: AttackTierContext | undefined, c: TierThresholds = HERO_ATTACK_TIER_THRESHOLDS): TierNum {
  if (ctx?.knockout) return KNOCKOUT_TIER;
  return tierOf(total, c);
}

/**
 * Reduced motion: the shared damage formation has faded through its stages by `leadIn`; the blow lands there and the
 * total fades out. No motion at all.
 */
export function reducedAttackTimeline(leadIn: number, fadeMs: number): { impactAt: number; endAt: number } {
  const impactAt = Math.max(0, leadIn);
  return { impactAt, endAt: impactAt + fadeMs + 120 };
}

/** A per-tier dial read off a config (`t1FlyMs` ... `t4FlyMs`). */
export function dialsOf<S extends string>(suffixes: readonly S[], tier: TierNum, c: Record<string, unknown>): Record<S, number> {
  return Object.fromEntries(suffixes.map((s) => [s, Number(c[`t${tier}${s}`])])) as Record<S, number>;
}

export { clamp };
