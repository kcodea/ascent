import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import {
  CARD_ART_RANGES, cancelEditCardArt, commitEditCardArt, getCardArt, saveCardArtToFile, setCardArt,
} from './cardArtConfig';

/**
 * The DIRECT-MANIPULATION layer for one card's art, mounted on the card while it has an open edit session.
 * Drag anywhere on the card to reposition, wheel to zoom, ✓ to keep, ✗ to put it back.
 *
 * ── Why the maths is in percentages of the measured box ───────────────────────────────────────────────────
 * A drag gives pixels, but an override is stored as a % of the art window so it holds at every size the card
 * renders at. So a drag converts: `dx / boxWidth * 100`. That conversion also means dragging the SAME card in
 * the shop and in the Compendium produces the same stored value despite very different pixel sizes.
 *
 * ── The rect is measured ONCE per drag ────────────────────────────────────────────────────────────────────
 * Not per move event. Reading layout on every pointermove is the documented anti-pattern in this codebase
 * (`insertRectsRef` does the same thing for card dragging), and the box cannot change mid-drag anyway.
 *
 * ── It sits on the CARD ROOT, but measures `.art` ─────────────────────────────────────────────────────────
 * `.art` is the frame's window and it CLIPS, so a button parented inside it can never sit outside the card —
 * which is where the ✗/✓ have to live, clear of the badges and the hand's hover-pop. So the layer covers the
 * whole card and reaches into `.art` for the box its percentages are relative to.
 */
export function CardArtEditor({ cardId }: { cardId: string }): JSX.Element {
  // Everything the live drag needs, captured on pointerdown. A ref, not state: this updates on every move and
  // must not re-render the card it is sitting inside.
  const drag = useRef<{ id: number; w: number; h: number; px: number; py: number; x0: number; y0: number } | null>(null);

  const clamp = (v: number, key: 'x' | 'y' | 'zoom'): number => {
    const [min, max] = CARD_ART_RANGES[key];
    return Math.min(max, Math.max(min, v));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    // The card underneath is draggable and clickable for real gameplay; while a session is open this layer
    // owns the pointer completely.
    e.preventDefault();
    e.stopPropagation();
    /* Measure the ART WINDOW, not this layer. The layer covers the whole card (so you can grab anywhere),
       but the stored offset is a % of the art window — measuring the card would make every drag land short
       by the ratio between the two. */
    const art = e.currentTarget.parentElement?.querySelector('.art');
    const box = (art ?? e.currentTarget).getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    const cur = getCardArt(cardId) ?? {};
    drag.current = {
      id: e.pointerId, w: box.width, h: box.height,
      px: e.clientX, py: e.clientY, x0: cur.x ?? 0, y0: cur.y ?? 0,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const cur = getCardArt(cardId) ?? {};
    setCardArt(cardId, {
      ...cur,
      x: clamp(d.x0 + ((e.clientX - d.px) / d.w) * 100, 'x'),
      y: clamp(d.y0 + ((e.clientY - d.py) / d.h) * 100, 'y'),
    });
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    const cur = getCardArt(cardId) ?? {};
    // Multiplicative, so a notch feels the same at every zoom level — an additive step is coarse when zoomed
    // out and imperceptible when zoomed in.
    const next = (cur.zoom ?? 1.12) * (e.deltaY < 0 ? 1.05 : 1 / 1.05);
    setCardArt(cardId, { ...cur, zoom: clamp(next, 'zoom') });
  };

  return (
    <div
      className="cardart-edit"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={onWheel}
      /* A double-click inside the session would otherwise bubble to the card and re-open a session on top of
         the one already running, resetting the ✗ snapshot to the half-dragged state. */
      onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      role="presentation"
    >
      <button
        type="button"
        className="cardart-edit-btn cancel"
        title="Discard these changes and put the card back as it was"
        aria-label="Discard card art changes"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); cancelEditCardArt(); }}
      >✗</button>
      <button
        type="button"
        className="cardart-edit-btn ok"
        title="Keep these changes and write them to cardArt.data.json"
        aria-label="Save card art changes"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
            e.stopPropagation();
            commitEditCardArt();
            // ✓ means "saved", so it goes to the file — not just the browser. A silent failure here is the
            // one outcome that would cost real work, so it is surfaced.
            void saveCardArtToFile().then((r) => {
              if (!r.ok) window.alert(`Card art save FAILED — your edit is still here.\n\n${r.error ?? ''}`);
            });
          }}
      >✓</button>
    </div>
  );
}
