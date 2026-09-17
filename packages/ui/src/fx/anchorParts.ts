import type { FxAnchorPart } from './def';
import type { FxAnchorPartPoints, FxAnchors, FxPartPoints, FxPoint } from './anchors';

export type { FxAnchorPartPoints, FxPartPoints } from './anchors';

/**
 * ANCHOR PARTS — "a target within a source". A layer anchored to `source`/`target`/`travel` can name a PART
 * of that unit's card to land on instead of the card's centre: a stat badge, the MEDALLION (the round tribe
 * plate — the owner's name for it), the tier badge, or an edge. `card` (the default, and every def written
 * before this) is the centre exactly as before.
 *
 * Three pieces, kept apart on purpose:
 *   • the pure maths (`partPointFromRects`, `partsUsedByLayers`) — testable headless;
 *   • one DOM read per unit (`readUnitPartPoints`) — one card rect plus one `querySelector` +
 *     `getBoundingClientRect` PER SELECTOR PART ACTUALLY USED, never per frame (`playDef` samples anchors
 *     once at fire time, see its header), so a fire stays "a few rect reads";
 *   • the glue (`withUnitParts`) that decorates a fire's `FxAnchors` with the parts the def's layers ask for.
 *
 * Selector parts reuse `reactTargets.ts`'s vocabulary and mirror `Card.tsx`'s markup — the same
 * `.badge.atk` / `.badge.hp` the `react` primitive already targets — rather than inventing a second one.
 * Edge parts are geometry off the card rect and need no query at all.
 */

export const FX_ANCHOR_PARTS: readonly FxAnchorPart[] = [
  'card', 'badge.attack', 'badge.health', 'medallion', 'tier', 'top', 'bottom', 'left', 'right',
];

/** The parts that name a child element of the unit. Everything else derives from the unit's own rect.
 *  `tier` skips the tier-7 `.tierglow` halo (rendered first, so a bare `.tierbadge` would pick it) and lands
 *  on the plaque / stars / text badge — whichever the card renders. */
const PART_SELECTOR: Partial<Record<FxAnchorPart, string>> = {
  'badge.attack': '.badge.atk',
  'badge.health': '.badge.hp',
  medallion: '.plate-tribe',
  tier: '.tierbadge:not(.tierglow)',
};

export function isAnchorPart(v: unknown): v is FxAnchorPart {
  return typeof v === 'string' && (FX_ANCHOR_PARTS as readonly string[]).includes(v);
}

export function isSelectorPart(part: FxAnchorPart): boolean {
  return PART_SELECTOR[part] !== undefined;
}

export interface PartRect { left: number; top: number; width: number; height: number }

const centre = (r: PartRect): FxPoint => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const usable = (r: PartRect | null | undefined): r is PartRect => r != null && r.width > 0 && r.height > 0;

/** Where `medallion` lands when the card has no `.plate-tribe` element — i.e. on ANY board/combat minion,
 *  since the ornate tribe plate renders on HAND cards only (`Card.tsx`'s `usePlate`). A fraction of the card
 *  height for the y of a bottom-centre point, matching where the hand card's plate gem sits, so a
 *  medallion-anchored def (embermouth, shout-icon-effect) lands on the lower card rather than dead-centre.
 *  Tunable — owner picked "bottom-centre" 2026-09-17; nudge this if the exact height wants adjusting. */
const MEDALLION_BOARD_Y_FRAC = 0.9;

/**
 * The point a part resolves to, given the unit's rect and — for a selector part — that part's own rect
 * (`null` when the card has no such element: a spell has no badges). `medallion` falls back to a bottom-centre
 * point (see `MEDALLION_BOARD_Y_FRAC`) because the tribe plate is hand-cards-only, so a board minion has no
 * such element; every other missing part falls back to the card centre, so a def is never thrown off-screen.
 */
export function partPointFromRects(card: PartRect, part: FxAnchorPart, partRect: PartRect | null): FxPoint {
  const c = centre(card);
  switch (part) {
    case 'top': return { x: c.x, y: card.top };
    case 'bottom': return { x: c.x, y: card.top + card.height };
    case 'left': return { x: card.left, y: c.y };
    case 'right': return { x: card.left + card.width, y: c.y };
    case 'card': return c;
    case 'medallion': return usable(partRect) ? centre(partRect) : { x: c.x, y: card.top + card.height * MEDALLION_BOARD_Y_FRAC };
    default: return usable(partRect) ? centre(partRect) : c;
  }
}

/** The distinct non-default parts a set of layers asks for — what a fire needs to resolve, and nothing more. */
export function partsUsedByLayers(layers: readonly { anchorPart?: FxAnchorPart | null }[]): FxAnchorPart[] {
  const out: FxAnchorPart[] = [];
  for (const l of layers) {
    const p = l.anchorPart;
    if (p && p !== 'card' && !out.includes(p)) out.push(p);
  }
  return out;
}

/** The minimum of an element this module reads — so the DOM path is testable with a stub. */
export interface UnitElementLike {
  getBoundingClientRect(): PartRect;
  querySelector(sel: string): UnitElementLike | null;
}

/**
 * The pure-TRANSLATION offset from an element's CURRENT (possibly mid-tween) box to its RESTING box — the same
 * transform-correction `Recruit.tsx`'s `restingCenterOf` makes. A card played from hand SLIDES into its
 * warband slot (a CSS/FLIP transform), so at fire time its `getBoundingClientRect` is the drop position, not
 * the slot; a part read off that raw rect lands where the card was RELEASED. Shifting every part rect by this
 * delta lands it on the settled slot instead — matching the transform-corrected base anchor.
 *
 * Zero when the element isn't transformed, has no layout, or is a test stub (no `offsetParent`), so combat
 * (nothing sliding) and the unit tests are unaffected. Assumes a translation (what a slot slide is); a scale
 * would make it approximate, which is the same assumption `restingCenterOf` makes.
 */
function restingDelta(unit: UnitElementLike, raw: PartRect): { dx: number; dy: number } {
  const el = unit as unknown as HTMLElement;
  if (typeof getComputedStyle !== 'function' || el.offsetParent == null) return { dx: 0, dy: 0 };
  const t = getComputedStyle(el).transform;
  if (t === 'none' || t === '') return { dx: 0, dy: 0 };
  const p = (el.offsetParent as HTMLElement).getBoundingClientRect();
  return { dx: p.left + el.offsetLeft - raw.left, dy: p.top + el.offsetTop - raw.top };
}

const shift = (r: PartRect, dx: number, dy: number): PartRect =>
  dx === 0 && dy === 0 ? r : { left: r.left + dx, top: r.top + dy, width: r.width, height: r.height };

/** Resolve `parts` for one unit element: one card rect, then one query + rect per SELECTOR part — each
 *  transform-corrected to its RESTING position (see `restingDelta`) so a card sliding into its slot resolves
 *  its parts at the slot, not mid-slide. */
export function readUnitPartPoints(unit: UnitElementLike, parts: readonly FxAnchorPart[]): FxPartPoints {
  const raw = unit.getBoundingClientRect();
  const { dx, dy } = restingDelta(unit, raw);
  const card = shift(raw, dx, dy);
  const out: FxPartPoints = {};
  for (const part of parts) {
    if (part === 'card') continue;
    const sel = PART_SELECTOR[part];
    const cr = sel === undefined ? null : (unit.querySelector(sel)?.getBoundingClientRect() ?? null);
    const rect = cr === null ? null : shift(cr, dx, dy);
    out[part] = partPointFromRects(card, part, rect);
  }
  return out;
}

/**
 * Decorate a fire's anchors with the parts its def uses, read off the units the moment is about — `find`
 * turns a uid into its element (`playDef` passes the same `unitSelector` lookup both surfaces' cards answer
 * to; injected so this module stays free of DOM selectors and import cycles). No parts, no uids, or nothing
 * found → the anchors are returned untouched, which is exactly the pre-parts behaviour.
 */
export function withUnitParts(
  anchors: FxAnchors,
  uids: { source?: string | null; target?: string | null } | undefined,
  parts: readonly FxAnchorPart[],
  find: (uid: string) => UnitElementLike | null,
): FxAnchors {
  if (parts.length === 0 || uids === undefined) return anchors;
  const resolved: FxAnchorPartPoints = {};
  for (const end of ['source', 'target'] as const) {
    const uid = uids[end];
    if (!uid) continue;
    const el = find(uid);
    if (el === null) continue;
    resolved[end] = readUnitPartPoints(el, parts);
  }
  if (resolved.source === undefined && resolved.target === undefined) return anchors;
  return { ...anchors, parts: resolved };
}

/** Parts read straight off known elements — the workbench's DOM-backed scenarios use this. */
export function partsFromElements(
  source: UnitElementLike | null,
  target: UnitElementLike | null,
  parts: readonly FxAnchorPart[],
): FxAnchorPartPoints | undefined {
  if (parts.length === 0 || (source === null && target === null)) return undefined;
  const out: FxAnchorPartPoints = {};
  if (source !== null) out.source = readUnitPartPoints(source, parts);
  if (target !== null) out.target = readUnitPartPoints(target, parts);
  return out;
}
