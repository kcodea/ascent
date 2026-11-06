/**
 * THE SLIDING SELECT GLOW (owner 2026-11-05: "when selecting a new menu item i want the select glow to slide over to that new
 * section. we will be doing a lot of slide transitions with this entire menu"). One reusable marker for any row of choices:
 * put an element with class `phk-slide` first inside the row, give the row `ref`, and the marker glides under whichever child
 * carries `.on`.
 *
 * Performance: the marker moves by `transform` only (translateX + scaleX of a fixed 100px box), so the glide never repaints.
 * Layout is read when the row renders or a tab changes size, never per frame. Offsets are the row's own layout pixels, which
 * the stage's scale does not touch, so no `toStage` conversion is needed.
 *
 * It re-measures on EVERY render of the row, not only when the selection changes (owner 2026-11-06: "when swapping from ranked
 * to versus the right side glow gets stuck in the wrong spot"): a row's tabs can change under a selection that stays the same
 * (the side panel's mode tab is renamed and Open Rooms joins it), which moves the selected tab. Only a new selection glides; any
 * other move snaps. Each tab is also watched for a size change (a late font, a relabel).
 *
 * The marker's `padding-left` (set in CSS) is how far the glow reaches past each side of the selected item.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';

const BASE = 100; // the marker's CSS width in px; scaleX stretches it to the selected item

export function useSlideMarker<E extends HTMLElement>(key: unknown, selector = '.on'): RefObject<E> {
  const rowRef = useRef<E>(null);
  const last = useRef<{ key: unknown; x: number; w: number } | null>(null);

  const place = (animate: boolean): void => {
    const row = rowRef.current;
    const marker = row?.querySelector<HTMLElement>(':scope > .phk-slide');
    if (!row || !marker) return;
    const on = row.querySelector<HTMLElement>(`:scope > ${selector}`);
    if (!on) { marker.style.opacity = '0'; return; }
    const ext = parseFloat(getComputedStyle(marker).paddingLeft) || 0;
    const x = on.offsetLeft - ext;
    const w = on.offsetWidth + ext * 2;
    const prev = last.current;
    if (prev && prev.key === key && prev.x === x && prev.w === w) return; // nothing moved
    // A new selection glides; the first placement and any other move (a relabel, a resize) snap.
    marker.classList.toggle('glide', animate && !!prev && prev.key !== key);
    marker.style.transform = `translateX(${x}px) scaleX(${w / BASE})`;
    marker.style.opacity = '1';
    last.current = { key, x, w };
  };

  // Every render: the tabs may have changed even when the selection did not.
  useLayoutEffect(() => { place(true); });

  // A tab (or the row) changing size after render snaps the marker to it.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return undefined; // (tests run without it)
    const ro = new ResizeObserver(() => place(false));
    ro.observe(row);
    for (const el of row.querySelectorAll(':scope > :not(.phk-slide)')) ro.observe(el);
    return () => ro.disconnect();
    // Re-observe when the selection changes, which is also when the set of tabs most often changes.
  }, [key]);

  return rowRef;
}
