import type { FxAnchors } from './anchors';
import { anchorsFromRects, type RectLike } from './boardAnchors';

/**
 * REAL screen anchors for a COMBAT MOMENT — the geometry half of the workbench → game bridge.
 *
 * `boardAnchors.ts` answers "where is the board, roughly" for the workbench's real-board preview: first
 * player unit, first opposing unit, sampled on a throttle. This answers the question the game actually
 * asks — "where are THESE two units, right now" — for a specific source/target pair out of a combat event.
 *
 * Selectors are NOT invented here. `unitSelector` is character-for-character the one Recruit builds and
 * hands to `useCombatReplay` as its `findEl` (`Recruit.tsx`), i.e. the same element every other combat FX
 * already measures; `.row` is the row class `boardAnchors.ts` already anchors `slot` to. Sharing them is
 * the point: a def-driven effect must land exactly where the hand-written one did.
 *
 * The rect → anchors MATH is not duplicated either — `combatAnchorsFromRects` folds a one-ended moment and
 * then delegates to `boardAnchors.ts`'s `anchorsFromRects`, so "unit centre", "slot = x from the unit, y
 * from the row midline" and "camera = viewport centre" have exactly one definition in the codebase.
 *
 * Pure/impure split matches `boardAnchors.ts`: `combatAnchorsFromRects` is total and DOM-free (and unit
 * tested directly); `anchorsForUnits` is the thin DOM read on top.
 *
 * NOT throttled and NOT cached, deliberately — unlike `readBoardAnchors` this is called ONCE per fire (a
 * combat moment), not from a per-frame updater, and the answer is different for every uid pair so a
 * single-slot cache would only ever miss. `playDef` then holds the returned snapshot for the effect's whole
 * life, so a fire costs exactly these few `getBoundingClientRect()` calls and no more. Nothing here polls.
 */

/** The two facing rows a combat unit can live in. Mirrors Recruit's `findEl` exactly (see the header). */
export const unitSelector = (uid: string): string =>
  `[data-zone="warband"] [data-uid="${uid}"], [data-zone="tavern"] [data-uid="${uid}"]`;

/** Everything `combatAnchorsFromRects` needs — the DOM read's output, and the only thing separating the
 *  pure math from the browser. */
export interface CombatRects {
  /** The source unit's rect, or `null` for a sourceless moment. */
  source: RectLike | null;
  /** The target unit's rect, or `null` for a targetless moment. */
  target: RectLike | null;
  /** The row containing whichever end is present, used as the `slot` anchor's vertical baseline. Optional —
   *  `slot` degrades to the source unit's own centre without it. */
  row?: RectLike | null;
  viewport: { w: number; h: number };
}

/**
 * PURE: rects → anchors, or `null` when there is nothing usable to anchor to.
 *
 * A one-ended moment still has to land somewhere: plenty of combat events have no source (a sourceless
 * buff, an aura tick) or no target, and `anchorsFromRects` requires both. So the missing end FOLDS onto the
 * present one — `source`, `target` and therefore the whole `travel` arc collapse to that single point,
 * which is the effect playing "on the one unit involved". The alternative, leaving the missing end at the
 * origin, would fling every such effect at the screen's top-left corner. Both ends missing = `null`.
 *
 * A rect that is present but zero-sized (an unlaid-out or hidden element) still yields `null`, via
 * `anchorsFromRects` — a 0×0 rect centres on the top-left corner and reads as a broken FX rather than as
 * "that unit isn't on screen".
 */
export function combatAnchorsFromRects(rects: CombatRects): FxAnchors | null {
  const source = rects.source ?? rects.target;
  const target = rects.target ?? rects.source;
  return anchorsFromRects({ source, target, row: rects.row, viewport: rects.viewport });
}

/**
 * Real screen anchors for a combat moment, read off the live DOM. `null` when the units aren't on screen.
 *
 * The two uid arguments carry different meanings for `null` vs "not found", and the distinction is what
 * makes the result trustworthy:
 *   • a `null` uid = the caller says this moment HAS no such end — it folds onto the other end (above);
 *   • a uid STRING that resolves to nothing = a unit that has died, unmounted, or hasn't rendered yet, so
 *     the caller asked for geometry that does not exist → `null`, and the caller skips the effect cleanly
 *     rather than firing it at the corner of the screen.
 *
 * `cursor` is deliberately absent: a combat moment has no cursor, and `resolveAnchor` already degrades an
 * unstaged anchor to the origin. A def whose layer is cursor-anchored is a workbench-only composition.
 */
export function anchorsForUnits(sourceUid: string | null, targetUid: string | null): FxAnchors | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  const sourceEl = sourceUid === null ? null : document.querySelector(unitSelector(sourceUid));
  if (sourceUid !== null && sourceEl === null) return null;
  const targetEl = targetUid === null ? null : document.querySelector(unitSelector(targetUid));
  if (targetUid !== null && targetEl === null) return null;
  // The SOURCE's own row (not a fixed warband/tavern selector): in combat the source may be on either side,
  // and `slot` means "the row midline of the unit the effect belongs to". Falls back to the target's row for
  // a sourceless moment, which is the row that end folded onto.
  const rowEl = (sourceEl ?? targetEl)?.closest('.row') ?? null;
  return combatAnchorsFromRects({
    source: sourceEl?.getBoundingClientRect() ?? null,
    target: targetEl?.getBoundingClientRect() ?? null,
    row: rowEl?.getBoundingClientRect() ?? null,
    viewport: { w: window.innerWidth, h: window.innerHeight },
  });
}

/**
 * The CARD id of a live combat unit, read off the same DOM the anchors come from (`Unit.tsx` renders it as
 * `data-card` beside `data-uid`). `null` when there is no such unit on screen — exactly the condition
 * `anchorsForUnits` already treats as "skip silently".
 *
 * Deliberately the DOM rather than the store: this is called from the choreo's cue runner, which already
 * resolves units through the DOM for anchoring, and threading combat state into it just to answer "which
 * card is this" would give two sources of truth about which units exist right now.
 */
export function cardIdForUid(uid: string | null): string | null {
  if (uid === null || typeof document === 'undefined') return null;
  const el = document.querySelector<HTMLElement>(unitSelector(uid));
  const cardId = el?.dataset.card;
  return cardId === undefined || cardId === '' ? null : cardId;
}
