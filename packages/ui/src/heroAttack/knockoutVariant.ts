/**
 * WHICH ATTACKS PLAY A KNOCKOUT VARIANT ("Tier V", owner ask 2026-10-02: "ancient tier animations should have a
 * separate tier of dmg specific for knockouts ... can you do this for all 4 ancient tier animations?").
 *
 * The rule, in one place:
 *  - a knockout always plays Tier IV ("Huge"), every style (owner 2026-09-29, R-PROG-ATTACK-20, `attackTier`);
 *  - EXCEPT an ANCIENT-rarity attack that has a Knockout variant: it plays that instead.
 *
 * It is driven by the cosmetic's RARITY (the catalog in @game/progression), not a list of ids, so a future Ancient
 * attack gets it the moment its runner has a variant: add its style to `KNOCKOUT_VARIANT_STYLES` and read
 * `isKnockoutVariant(input)` in its plan. An Ancient attack with no variant yet (not in the set) falls back to Huge.
 * Every other rarity keeps playing Huge on a knockout, unchanged.
 */
import { COSMETICS, cosmeticOf, type CosmeticRarity } from '@game/progression';

/** The rarity whose attacks get a Knockout variant. */
export const KNOCKOUT_VARIANT_RARITY: CosmeticRarity = 'ancient';

/**
 * The styles whose runner HAS a Knockout variant (their plan reads `isKnockoutVariant`). Adding an Ancient attack's
 * variant = its style here + the plan/runner change (see docs/devlog/2026-10-02-ancient-knockout-tier.md).
 */
export const KNOCKOUT_VARIANT_STYLES: ReadonlySet<string> = new Set(['arcana', 'holy', 'stitch', 'bullettime']);

/**
 * The rarity of the attack that plays: the attacker's equipped cosmetic when it is the one playing `style`, else the
 * catalog's hero attack for that style (the dev override forces a style with no cosmetic behind it). Null = Classic or
 * an unknown style.
 */
export function attackRarityOf(style: string, cosmeticId?: string | null): CosmeticRarity | null {
  const own = cosmeticOf(cosmeticId);
  if (own && own.category === 'hero_attack' && own.assets.style === style) return own.rarity;
  const def = COSMETICS.find((c) => c.category === 'hero_attack' && c.assets.style === style);
  return def ? def.rarity : null;
}

/** The pure rule: a knockout, an Ancient attack, and a runner with a variant. */
export function playsKnockoutVariant(i: { knockout: boolean; rarity: CosmeticRarity | null | undefined; hasVariant: boolean }): boolean {
  return i.knockout && i.rarity === KNOCKOUT_VARIANT_RARITY && i.hasVariant;
}

/** Does this blow play the attack's Knockout variant? (`variants` is a test seam.) */
export function knockoutVariantFor(i: { style: string; knockout: boolean; cosmeticId?: string | null; variants?: ReadonlySet<string> }): boolean {
  if (!i.knockout) return false;
  return playsKnockoutVariant({
    knockout: true,
    rarity: attackRarityOf(i.style, i.cosmeticId),
    hasVariant: (i.variants ?? KNOCKOUT_VARIANT_STYLES).has(i.style),
  });
}
