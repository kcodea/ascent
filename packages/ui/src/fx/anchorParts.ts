import type { FxAnchorPart } from './def';
import type { FxAnchorPartPoints, FxAnchors, FxPartPoints, FxPoint } from './anchors';

export type { FxAnchorPartPoints, FxPartPoints } from './anchors';

/**
 * ANCHOR PARTS — "a target within a source". A layer anchored to `source`/`target`/`travel` can name a PART
 * of that unit's card to land on instead of the card's centre: a stat badge, the MEDALLION (the round mechanic
 * gem at the card's base that PULSES on a Shout / Rally / crit / watcher — `Card.tsx`'s `.cgem`, the owner's
 * name for it), the tier badge, or an edge. `card` (the default, and every def written before this) is the
 * centre exactly as before.
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
  // The trigger MEDALLION — the round mechanic gem at the card's base that a Shout / Rally / crit / watcher
  // pulses (`Card.tsx`'s `.cgem`), present on every board minion. NOT `.plate-tribe` (the ornate tribe plate
  // on HAND cards only), which board minions never render — that mapping resolved every board medallion to
  // the card centre.
  medallion: '.cgem',
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

/**
 * The point a part resolves to, given the unit's rect and — for a selector part — that part's own rect
 * (`null` when the card has no such element: a spell has no badges). A missing or empty part rect falls back
 * to the card centre, so a def is never thrown off-screen by a card that lacks the part.
 */
export function partPointFromRects(card: PartRect, part: FxAnchorPart, partRect: PartRect | null): FxPoint {
  const c = centre(card);
  switch (part) {
    case 'top': return { x: c.x, y: card.top };
    case 'bottom': return { x: c.x, y: card.top + card.height };
    case 'left': return { x: card.left, y: c.y };
    case 'right': return { x: card.left + card.width, y: c.y };
    case 'card': return c;
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
 * The card's SETTLED (un-transformed) layout box, from the offsetParent + offset* geometry — the same
 * transform-invariant read `Recruit.tsx`'s `restingCenterOf` makes for the centre. A just-played card is BOTH
 * sliding into its warband slot (a translate) AND hover-enlarged (a scale + lift) at fire time; this returns
 * the slot box regardless. Falls back to the live rect when the element isn't transformed, has no layout, or
 * is a test stub (no `offsetParent`) — so combat and the unit tests are unaffected. Assumes the offsetParent
 * (the row) is itself untransformed, exactly as `restingCenterOf` does.
 */
function settledCardRect(unit: UnitElementLike, raw: PartRect): PartRect {
  const el = unit as unknown as HTMLElement;
  if (typeof getComputedStyle !== 'function' || el.offsetParent == null) return raw;
  const t = getComputedStyle(el).transform;
  if (t === 'none' || t === '') return raw;
  const p = (el.offsetParent as HTMLElement).getBoundingClientRect();
  return { left: p.left + el.offsetLeft, top: p.top + el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
}

/**
 * Resolve `parts` for one unit element: one card rect, then one query + rect per SELECTOR part.
 *
 * Each part's rect is mapped from its FRACTIONAL position inside the card's live (possibly transformed) rect
 * onto the card's SETTLED layout box (see `settledCardRect`). A fraction is invariant under the card's affine
 * transform, so this cancels BOTH the play-in slide (translate) AND the hover enlarge (scale) at once — a
 * medallion-anchored shout lands on the gem's settled slot position, not where the card was released or drawn
 * mid-animation (owner reports 2026-09-18). With no transform (combat, workbench, test stubs) the settled box
 * equals the live rect and the mapping is the identity, so nothing else changes.
 */
export function readUnitPartPoints(unit: UnitElementLike, parts: readonly FxAnchorPart[]): FxPartPoints {
  const raw = unit.getBoundingClientRect();
  const settled = settledCardRect(unit, raw);
  const sx = raw.width > 0 ? settled.width / raw.width : 1;
  const sy = raw.height > 0 ? settled.height / raw.height : 1;
  const toSettled = (r: PartRect): PartRect => ({
    left: settled.left + (r.left - raw.left) * sx,
    top: settled.top + (r.top - raw.top) * sy,
    width: r.width * sx,
    height: r.height * sy,
  });
  const out: FxPartPoints = {};
  for (const part of parts) {
    if (part === 'card') continue;
    const sel = PART_SELECTOR[part];
    const cr = sel === undefined ? null : (unit.querySelector(sel)?.getBoundingClientRect() ?? null);
    out[part] = partPointFromRects(settled, part, cr === null ? null : toSettled(cr));
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
