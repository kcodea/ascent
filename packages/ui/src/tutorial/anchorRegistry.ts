/**
 * TUTORIAL — anchor registry (presentation seam).
 *
 * A course names WHERE a coach panel / spotlight points as a stable `TutorialAnchorRef` (see
 * `@game/sim` `tutorial/types.ts`); this file is the ONLY place that knows those refs resolve to real DOM
 * nodes. Everything gameplay-side is DOM (React), so we resolve a ref to a `document.querySelector` and read
 * its `getBoundingClientRect()`.
 *
 * PERF (north star): rects are measured ONCE when a step activates and re-measured only on resize/scroll —
 * NEVER per frame or per render (the repo's `insertRectsRef` measure-once discipline). `useAnchorRects`
 * batches the reads and throttles resize/scroll through a single rAF, so a burst of events costs one layout
 * read, not one per event. `getBoundingClientRect` already folds in CSS transforms, so we measure elements at
 * rest and let the animated cutout follow the cached rect.
 */

import { useEffect, useRef, useState } from 'react';
import type { TutorialAnchorRef } from '@game/sim';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Ref → selector. The authoritative anchor→selector map lives here (mirrors the design doc). Card/cardBody/
// boardSlot resolve against a container then narrow, so they get their own branches below.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The singleton-chrome anchors: a fixed id → one stable selector. Structural refs (card/boardSlot/…) are
 *  handled procedurally in `resolveAnchorEl`. */
const UI_SELECTORS: Record<string, string> = {
  gold: '.goldpill',
  shop: '[data-zone="tavern"] .row',
  'tavern-up': '.tvbwrap',
  refresh: '.rfbwrap',
  freeze: '.frzwrap',
  'end-turn': '.etbwrap',
  'hero-power': '.statusbar .heropowerbtn',
  warband: '[data-zone="warband"] .row.warband',
  hand: '[data-zone="hand"] .row.hand',
  health: '.statusbar .hpbox',
  'lobby-rail': '.lobbyrail',
  'lobby-self': '.lobbyseat.you',
  'lobby-next': '.lobbyseat.foe',
  // The Discover / Choose-One overlay. Absent unless a pick is open, which the registry already treats as
  // "no element" — so a step may list it safely on a beat where the modal has not opened yet.
  discover: '.discover-ov',
  hud: '.bar',
};

/** Zone → the card-row container a card of that zone lives in. */
const CARD_ZONE_CONTAINER: Record<'shop' | 'hand' | 'board', string> = {
  shop: '[data-zone="tavern"] .row',
  board: '[data-zone="warband"] .row',
  hand: '[data-zone="hand"]',
};

/** Escape a uid for use inside a `[data-uid="…"]` attribute selector — uids are minted at runtime and could,
 *  in principle, contain quotes. `CSS.escape` covers the attribute-value case. */
function attrEsc(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value;
}

/**
 * Resolve a ref to its live element (or null if it isn't mounted / found). Pure lookup — no measurement — so
 * callers can decide when to read layout.
 */
export function resolveAnchorEl(ref: TutorialAnchorRef): Element | null {
  switch (ref.kind) {
    case 'ui':
      return document.querySelector(UI_SELECTORS[ref.id] ?? '');
    case 'card': {
      const container = CARD_ZONE_CONTAINER[ref.zone];
      return document.querySelector(`${container} .card[data-uid="${attrEsc(ref.uid)}"]`);
    }
    case 'cardBody': {
      const container = CARD_ZONE_CONTAINER[ref.zone];
      const card = document.querySelector(`${container} .card[data-uid="${attrEsc(ref.uid)}"]`);
      if (!card) return null;
      // The rules/keyword text area; fall back to the whole card when a token has no separate body.
      return card.querySelector('.cbody') ?? card;
    }
    case 'boardSlot': {
      const row = document.querySelector('[data-zone="warband"] .row.warband');
      if (!row) return null;
      const slot = row.querySelectorAll(':scope > .card')[ref.index];
      // Out of range = an empty slot: fall back to the row itself so the spotlight lands on the warband.
      return slot ?? row;
    }
    case 'lobbySeat':
      return document.querySelector(`.lobbyseat[data-seat="${attrEsc(ref.seatId)}"]`);
    default:
      return null;
  }
}

/**
 * Resolve a ref straight to its rect, measuring once at call time. Prefer `measureAnchors` /
 * `useAnchorRects` for batches so all reads happen in one pass.
 */
export function resolveAnchorRect(ref: TutorialAnchorRef): DOMRect | null {
  const el = resolveAnchorEl(ref);
  return el ? el.getBoundingClientRect() : null;
}

/** A batch of anchors and the rects measured for them, index-aligned with `refs`. */
export interface AnchorRectCache {
  rects: (DOMRect | null)[];
  refs: TutorialAnchorRef[];
}

/**
 * Measure a batch of anchors in a single READ pass — resolve every element first, then read every rect, so no
 * layout write is interleaved between reads (avoids forced synchronous reflow between calls).
 */
export function measureAnchors(refs: TutorialAnchorRef[]): AnchorRectCache {
  const els = refs.map(resolveAnchorEl);
  const rects = els.map((el) => (el ? el.getBoundingClientRect() : null));
  return { rects, refs };
}

/** Referential equality is fine for the deps array; we JSON-compare the refs shape so a new-but-equal array
 *  doesn't force a re-measure. Refs are small pure-data objects, so this is cheap. */
function refsKey(refs: TutorialAnchorRef[]): string {
  return JSON.stringify(refs);
}

/**
 * Measure a set of anchors once on mount, again whenever `deps` change or the refs change, and again on window
 * `resize` / `scroll`, and when a CSS transition/animation finishes — throttled through a single rAF so a burst
 * of events collapses to one layout read. NEVER measures in a continuous loop. Returns the index-aligned rect
 * array (nulls for unmounted anchors).
 *
 * WHY animation-end (owner report 2026-08-20: "step 12's highlight box is not on the packstrider, it's off to
 * the left and up slightly"): a step often activates in the same commit as the action that satisfied the
 * PREVIOUS step — "use your power on Packstrider" activates the instant Packstrider is played, while the card
 * is still gliding into its board slot and the row is still reflowing around it. The single measurement taken
 * at activation therefore captured the card MID-FLIGHT, and nothing ever corrected it, so the cutout sat at
 * that stale position for the whole step. Re-measuring when the movement finishes fixes every anchor measured
 * mid-move, not just that one step, and stays event-driven — no polling loop.
 */
export function useAnchorRects(refs: TutorialAnchorRef[], deps: unknown[]): (DOMRect | null)[] {
  const [rects, setRects] = useState<(DOMRect | null)[]>(() => measureAnchors(refs).rects);
  // Keep the latest refs in a ref so the resize/scroll listener always measures the current set without
  // re-subscribing on every refs change.
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const rafRef = useRef<number | null>(null);
  const key = refsKey(refs);

  useEffect(() => {
    // Measure now (mount / deps / refs changed).
    setRects(measureAnchors(refsRef.current).rects);

    const measure = (): void => {
      rafRef.current = null;
      setRects(measureAnchors(refsRef.current).rects);
    };
    const schedule = (): void => {
      // Collapse a burst into one rAF-scheduled measure; never a running loop.
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(measure);
    };

    window.addEventListener('resize', schedule);
    // Capture-phase scroll so we catch scrolls in any nested scroller, not just the window.
    window.addEventListener('scroll', schedule, true);
    // Capture phase so a card's own transition reaches us wherever it sits in the tree. Both events collapse
    // into the SAME rAF as resize/scroll, so a board of cards finishing together costs one layout read total.
    window.addEventListener('transitionend', schedule, true);
    window.addEventListener('animationend', schedule, true);
    return () => {
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('transitionend', schedule, true);
      window.removeEventListener('animationend', schedule, true);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [key, ...deps]); // deps is a caller-supplied dependency list, spread intentionally

  return rects;
}
