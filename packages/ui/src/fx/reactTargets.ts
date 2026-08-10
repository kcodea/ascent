/**
 * WHO a `react` layer plays on, and WHICH PART of them — the targeting half of the DOM effect layer.
 *
 * Every other primitive draws into a Pixi container at a screen POINT, so its whole notion of "where" is an
 * `FxAnchors` pair of coordinates. A react layer animates the actual card DOM, so it needs elements, and
 * elements are found the same way the anchor code already finds them: `[data-uid]` inside a `.row`. No new
 * selectors are invented here — `unitSelector` comes from `combatAnchors.ts`, `.row` is the same row class
 * `boardAnchors.ts` anchors `slot` to. A react layer that lands somewhere a Pixi layer would not is a bug.
 *
 * Three independent questions, deliberately kept apart:
 *   • **reach** — which UNITS (`docs/fx-vocabulary.md`). Positional, chosen by the author.
 *   • **order** — in what sequence those units are traversed: ripple / cascade / volley.
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

import { boardRoot } from './boardAnchors';
import { unitSelector } from './combatAnchors';

/** Which units a react layer plays on, relative to the subject. */
export type FxReach = 'self' | 'neighbours' | 'allies' | 'board';

/** Runtime list for the param picker — kept next to the type so "what can be picked" and "what can resolve"
 *  can't drift apart (same pattern as `FX_ANCHOR_IDS`). */
export const FX_REACHES: readonly FxReach[] = ['self', 'neighbours', 'allies', 'board'];

/**
 * In what ORDER the recipients are traversed — a separate axis from `reach`, which only says WHO.
 *
 * The two were collapsed at first, and the collapse was a real defect: a flat "ordered by distance" list
 * made the units either side of the subject fire one after another, so a symmetric ripple read as
 * one-sided. Splitting them also makes the two obvious looks both reachable, which one axis could not
 * express — the same set of allies can ripple out from the subject OR sweep across the row.
 *
 * Terms are `docs/fx-vocabulary.md`'s, deliberately:
 *  - `ripple`  — outward from the subject in both directions, by distance. Equal distance lands together.
 *  - `cascade` — left → right across the row, ignoring where the subject stands.
 *  - `volley`  — everyone at once, no offset.
 */
export type FxOrder = 'ripple' | 'cascade' | 'volley';

export const FX_ORDERS: readonly FxOrder[] = ['ripple', 'cascade', 'volley'];

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
 * PURE: which uids a reach selects, GROUPED — everything in a group fires at the same moment, and groups
 * are spaced by the layer's `gap`.
 *
 * Groups, not a flat list, and for `ripple` that is the whole correctness of it. `docs/fx-vocabulary.md`
 * defines ripple as "outward from the subject in both directions, ordered by distance" — so the units
 * either side of the subject are at the SAME distance and must land TOGETHER. Returning them flat made the
 * caller stagger them one after another, and with any falloff the right-hand neighbour then arrived both
 * later and weaker: it read as "only the left one reacted". (Reported from live authoring, 2026-08-03.)
 *
 * Under `ripple`, group 0 is always `[subject]` — see "the subject is an ordinary recipient". Within a ring
 * the left side is listed first, purely so the order is deterministic; they fire simultaneously, so it is
 * not a visual choice. The opposing row forms one final ring: it has no meaningful distance from a subject
 * across the board, and spreading it by index would invent a sweep the geometry doesn't justify.
 *
 * A subject that isn't in `row` (an off-board caster, a unit that just died) degrades to `[[subject]]` for
 * every reach: there is no position to spread from, and firing at the whole board instead would turn a
 * missing unit into a board-wide effect.
 */
export function orderByReach(
  row: readonly string[],
  others: readonly string[],
  subject: string,
  reach: FxReach,
  order: FxOrder = 'ripple',
): string[][] {
  if (reach === 'self') return [[subject]];
  const idx = row.indexOf(subject);
  if (idx < 0) return [[subject]];

  // ── who ──────────────────────────────────────────────────────────────────────────────────────────
  // Distance from the subject is computed once here and drives BOTH the reach cut and the ripple
  // grouping, so "which units" and "how far out" can never disagree.
  const near = row
    .map((uid, i) => ({ uid, d: Math.abs(i - idx), i }))
    .filter((e) => (reach === 'neighbours' ? e.d <= 1 : true));
  const opposing = others.filter((uid) => uid !== subject).map((uid, i) => ({ uid, d: Infinity, i }));
  const chosen = reach === 'board' ? [...near, ...opposing] : near;

  // ── in what order ────────────────────────────────────────────────────────────────────────────────
  if (order === 'volley') return [chosen.map((e) => e.uid)];
  if (order === 'cascade') {
    // Board order, left to right, each unit its own group — a sweep ACROSS the row that ignores where the
    // subject stands. The opposing row trails after, since its indices are its own.
    const sorted = [...chosen].sort((a, b) => (a.d === Infinity ? 1 : b.d === Infinity ? -1 : 0) || a.i - b.i);
    return sorted.map((e) => [e.uid]);
  }
  // ripple: one group per distance, so both sides of the subject land TOGETHER. The opposing row has no
  // meaningful distance from a subject across the board, so it forms one final ring rather than a sweep.
  const rings = new Map<number, string[]>();
  for (const e of chosen) {
    const ring = rings.get(e.d);
    if (ring === undefined) rings.set(e.d, [e.uid]);
    else ring.push(e.uid);
  }
  return [...rings.entries()].sort((a, b) => a[0] - b[0]).map(([, uids]) => uids);
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
  // Scoped to `boardRoot()`, not the document: with the workbench stage up, the live game's rows are still
  // in the DOM behind it, and an unscoped scan would report units from a board nobody can see as "the
  // opposing side". See `boardAnchors.boardRoot`.
  const rows = [...boardRoot().querySelectorAll('.row')].filter((r) => r !== row);
  return rows.flatMap((r) => [...r.querySelectorAll('[data-uid]')].map(uidOf))
    .filter((u): u is string => u !== null);
}

/** The live element for a uid, or `null` if it isn't on screen (died, unmounted, not yet rendered). */
export function unitElement(uid: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(unitSelector(uid));
}

/**
 * Subject uid → the recipient RINGS for a reach, read off the live DOM. Each ring fires together; rings are
 * spaced by the layer's `gap`.
 *
 * `[[subject]]` (not `[]`) when the subject isn't on screen: the caller still gets a well-formed schedule,
 * and the per-recipient element lookup is what drops it — one place decides "not on screen", not two.
 */
export function recipientsFor(subject: string, reach: FxReach, order: FxOrder = 'ripple'): string[][] {
  if (reach === 'self' || typeof document === 'undefined') return [[subject]];
  const el = unitElement(subject);
  if (el === null) return [[subject]];
  return orderByReach(rowUids(el), otherRowUids(el), subject, reach, order);
}
