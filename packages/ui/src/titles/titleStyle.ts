/**
 * TITLES: how a title LOOKS (owner ask 2026-09-28: "show the title + the titles colors if it has colors etc as a
 * way of showing off their flair").
 *
 * Today every title paints in its RARITY colour (the shared `.r-common` .. `.r-ancient` tokens in styles.css,
 * the same ones the Collection uses). Hero-mastery titles (designed, not built yet) will carry their OWN style: a
 * gradient and an optional effect, keyed by title id in `TITLE_STYLES` below. Adding one is a single entry here;
 * `TitleBadge` already renders both. No catalog or snapshot change is needed, because a snapshot records only the
 * title id and the look is resolved at render time.
 *
 * Pure (no store, no React), so the resolver is cheap to test and to call from any render.
 */
import { isMasterTitle, titleOf, type CosmeticRarity, type RunCosmeticSnapshot } from '@game/progression';

/** A title's custom look. `gradient` is any CSS gradient, painted into the text. `effect: 'shimmer'` adds a light
 *  sweep that animates TRANSFORM only (compositor-only, docs/performance.md), and stops under reduced motion. */
export interface TitleCustomStyle {
  gradient?: string;
  effect?: 'shimmer';
}

/** Custom looks by title id. Empty today: every live title uses its rarity colour. */
export const TITLE_STYLES: Readonly<Record<string, TitleCustomStyle>> = Object.freeze({});

/** Everything a renderer needs to paint one title. */
export interface TitleLook {
  id: string;
  name: string;
  rarity: CosmeticRarity;
  custom: TitleCustomStyle | null;
  /** A hero title's MASTER version (10 Ranked 1sts with the hero, owner 2026-09-29): painted as the golden plate with
   *  embroidered text, whatever `custom` says. */
  master: boolean;
}

/**
 * The look of the title a snapshot names, or null to show nothing. Null for an unknown, retired or non-title id
 * (`titleOf` is the one gate), so a stale or forged id never reaches the screen.
 */
export function titleLookOf(snapshot: RunCosmeticSnapshot | null | undefined, styles: Readonly<Record<string, TitleCustomStyle>> = TITLE_STYLES): TitleLook | null {
  const def = titleOf(snapshot);
  if (!def) return null;
  return { id: def.id, name: def.name, rarity: def.rarity, custom: styles[def.id] ?? null, master: isMasterTitle(def.id) };
}

/** The same, from a bare title id (a profile row, a leaderboard row). */
export const titleLookOfId = (id: string | null | undefined, styles?: Readonly<Record<string, TitleCustomStyle>>): TitleLook | null =>
  (id ? titleLookOf({ title: id }, styles) : null);
