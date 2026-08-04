/**
 * WHO a `react` layer plays on, and WHICH PART of them — the targeting half of the DOM effect layer.
 *
 * Every other primitive draws into a Pixi container at a screen POINT, so its whole notion of "where" is an
 * `FxAnchors` pair of coordinates. A react layer animates the actual card DOM, so it needs elements, and
 * elements are found the same way the anchor code already finds them: `[data-uid]` inside a `.row`. No new
 * selectors are invented here — `unitSelector` comes from `combatAnchors.ts`, `.row` is the same row class
 * `boardAnchors.ts` anchors `slot` to. A react layer that lands somewhere a Pixi layer would not is a bug.
 *
 * Two independent questions, deliberately kept apart:
 *   • **reach** — which UNITS (`docs/fx-vocabulary.md`). Positional, chosen by the author.
 *   • **part** — which piece of each unit's card. `card`, or the stat badges split into their
 *     `plate` (the circle) and `value` (the digit) — see `Card.tsx`.
 *
 * Reach is NOT `FxBinding.fanOut`. Fan-out asks "who did this moment happen to" and only the combat log
 * knows; reach asks "how far does the look spread from each of those" and only the author knows. They
 * compose: fan-out picks the subjects, reach spreads from each.
 *
 * Pure/impure split mirrors `boardAnchors.ts`: `orderByReach` is total and DOM-free (unit-tested directly);
 * the reads below are the thin browser layer on top.
 */

import { unitSelector } from './combatAnchors';

/** Which units a react layer plays on, relative to the subject. */
export type FxReach = 'self' | 'neighbours' | 'allies' | 'board';

/** Runtime list for the param picker — kept next to the type so "what can be picked" and "what can resolve"
 *  can't drift apart (same pattern as `FX_ANCHOR_IDS`). */
export const FX_REACHES: readonly FxReach[] = ['self', 'neighbours', 'allies', 'board'];

/**
 * Which piece of a card a react layer animates.
 *
 * The badge entries exist because a badge is three nodes: a wrapper that seats the pair, a `plate` (the
 * circle) and a `value` (the digit), as siblings. That split is what makes "swell the circle while the
 * number counts up" expressible — animating the wrapper moves both, which is a different (and also useful)
 * effect. Plural entries hit attack AND health together, which is what a stat change usually wants.
 */
export type FxPart =
  | 'card'
  | 'badges' | 'badge.attack' | 'badge.health'
  | 'plates' | 'plate.attack' | 'plate.health'
  | 'values' | 'value.attack' | 'value.health';

export const FX_PARTS: readonly FxPart[] = [
  'card',
  'badges', 'badge.attack', 'badge.health',
  'plates', 'plate.attack', 'plate.health',
  'values', 'value.attack', 'value.health',
];

/**
 * part → a selector RELATIVE to the unit element. `null` means the unit element itself.
 *
 * These mirror `Card.tsx`'s markup exactly. `> .plate` / `> .value` are direct-child selectors on purpose:
 * `.plate` is also the prefix of unrelated card classes (`plate-tribe`, `plated`), and a descendant
 * selector would be one future class away from silently animating the wrong node.
 */
const PART_SELECTOR: Record<FxPart, string | null> = {
  card: null,
  badges: '.badge',
  'badge.attack': '.badge.atk',
  'badge.health': '.badge.hp',
  plates: '.badge > .plate',
  'plate.attack': '.badge.atk > .plate',
  'plate.health': '.badge.hp > .plate',
  values: '.badge > .value',
  'value.attack': '.badge.atk > .value',
  'value.health': '.badge.hp > .value',
};

/** The elements a part names inside one unit. Empty when the card doesn't have that part — a spell has no
 *  stat badges, so a badge-targeted react simply doesn't play on it rather than erroring. */
export function partElements(unit: Element, part: FxPart): HTMLElement[] {
  const sel = PART_SELECTOR[part];
  if (sel === null) return unit instanceof HTMLElement ? [unit] : [];
  return [...unit.querySelectorAll<HTMLElement>(sel)];
}

/**
 * PURE: which uids a reach selects, in the order the effect should traverse them.
 *
 * **The subject is always first, and is always included** — see "the subject is an ordinary recipient" in
 * `docs/fx-vocabulary.md`. Everything after it is ordered by DISTANCE from the subject, so the effect
 * ripples outward rather than sweeping left-to-right; at equal distance the left side goes first, purely so
 * the order is deterministic (an effect that reordered itself between plays would be unreviewable).
 *
 * A subject that isn't in `row` (an off-board caster, a unit that just died) degrades to `[subject]` for
 * every reach: there is no position to spread from, and firing at the whole board instead would turn a
 * missing unit into a board-wide effect.
 */
export function orderByReach(
  row: readonly string[],
  others: readonly string[],
  subject: string,
  reach: FxReach,
): string[] {
  if (reach === 'self') return [subject];
  const idx = row.indexOf(subject);
  if (idx < 0) return [subject];

  const byDistance = row
    .map((uid, i) => ({ uid, d: Math.abs(i - idx), left: i < idx }))
    .sort((a, b) => (a.d !== b.d ? a.d - b.d : Number(b.left) - Number(a.left)));

  if (reach === 'neighbours') return byDistance.filter((e) => e.d <= 1).map((e) => e.uid);
  const allies = byDistance.map((e) => e.uid);
  if (reach === 'allies') return allies;
  return [...allies, ...others.filter((uid) => uid !== subject)];
}

/** A unit's uid, or `null` for an element that isn't a unit. */
const uidOf = (el: Element): string | null => el.getAttribute('data-uid');

/**
 * The uids in a row, in board order — the DOM read `orderByReach` needs. `.row` is the row container the
 * anchor code already uses; a unit outside one has no neighbours by definition.
 */
export function rowUids(unit: Element): string[] {
  const row = unit.closest('.row');
  if (row === null) return [];
  return [...row.querySelectorAll('[data-uid]')].map(uidOf).filter((u): u is string => u !== null);
}

/** Every unit uid in the OTHER row — the opposing side. Empty when only one row is on screen. */
export function otherRowUids(unit: Element): string[] {
  const row = unit.closest('.row');
  if (row === null) return [];
  const rows = [...document.querySelectorAll('.row')].filter((r) => r !== row);
  return rows.flatMap((r) => [...r.querySelectorAll('[data-uid]')].map(uidOf))
    .filter((u): u is string => u !== null);
}

/** The live element for a uid, or `null` if it isn't on screen (died, unmounted, not yet rendered). */
export function unitElement(uid: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(unitSelector(uid));
}

/**
 * Subject uid → the ordered recipient uids for a reach, read off the live DOM.
 *
 * `[subject]` (not `[]`) when the subject isn't on screen: the caller still gets a well-formed schedule,
 * and the per-recipient element lookup is what drops it — one place decides "not on screen", not two.
 */
export function recipientsFor(subject: string, reach: FxReach): string[] {
  if (reach === 'self' || typeof document === 'undefined') return [subject];
  const el = unitElement(subject);
  if (el === null) return [subject];
  return orderByReach(rowUids(el), otherRowUids(el), subject, reach);
}
