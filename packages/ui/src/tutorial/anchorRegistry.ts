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
 * A MEASURE TICK — a counter that bumps whenever the anchors on screen may have moved, so a caller that
 * measures inside a `useMemo` can list it in the deps and re-measure exactly then.
 *
 * WHY A TICK AND NOT A HOOK THAT RETURNS RECTS (owner report 2026-08-20, still wrong 2026-08-21): the older
 * `useAnchorRects` did own the rects — and nothing ever imported it, so its re-measure logic never ran once.
 * The controller measures cutouts AND connector endpoints together inside one memo; handing it a tick fixes
 * the staleness without splitting that measurement in two.
 *
 * WHAT GOES STALE. A step usually activates in the same commit as the action that satisfied the previous one
 * — "use your power on Packstrider" activates the instant Packstrider is played, while the card is still
 * growing into its board slot. The measurement taken then catches the card MID-FLIGHT (measured 6px small and
 * 11px high in the 2026-08-21 repro) and nothing corrected it, so the cutout sat off the card all step.
 *
 * TWO SOURCES, both bounded — never a polling loop (the perf contract):
 *  - EVENTS: resize / scroll / transitionend / animationend, all collapsed into one rAF.
 *  - A SETTLE SWEEP on step change: a handful of re-measures across the ~600ms an entrance takes. This is what
 *    catches movement that emits no DOM event at all — a WAAPI/GSAP tween fires neither `transitionend` nor
 *    `animationend`, so events alone cannot be trusted to signal "it landed".
 */
const SETTLE_SWEEP_MS = [0, 120, 300, 620] as const;

export function useAnchorMeasureTick(stepKey: string, suspended = false): number {
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // SUSPENDED while combat animates. The board fires transition/animation events continuously during a
    // fight, so leaving the listeners attached would bump the tick every frame — re-running the caller's
    // measure memo ~60x/s, which is the per-frame layout loop this module exists to avoid. Nothing is
    // spotlighted mid-fight anyway (the overlay drops its cutouts), so there is nothing to keep aligned.
    if (suspended) return;
    const bump = (): void => setTick((t) => t + 1);
    const measure = (): void => { rafRef.current = null; bump(); };
    const schedule = (): void => {
      if (rafRef.current != null) return; // collapse a burst into one rAF
      rafRef.current = requestAnimationFrame(measure);
    };

    // The settle sweep for THIS step. Bounded and self-cancelling.
    const timers = SETTLE_SWEEP_MS.map((ms) => window.setTimeout(bump, ms));

    window.addEventListener('resize', schedule);
    // Capture phase so we catch scrolls/animations anywhere in the tree, not just on window.
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('transitionend', schedule, true);
    window.addEventListener('animationend', schedule, true);
    return () => {
      for (const t of timers) window.clearTimeout(t);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('transitionend', schedule, true);
      window.removeEventListener('animationend', schedule, true);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [stepKey, suspended]);

  return tick;
}
