import { useEffect, useRef } from 'react';
import { Card, type CardView } from './Card';
import { pixiFx } from './pixiFx';
import { fireCardShine, getCardToHandFxConfig } from './cardToHandFxConfig';

/**
 * The flying card shown when a card is sent to your hand (combat grant OR recruit-phase conjure). On mount it
 * fires the Pixi shine sweep + sparkles; the card's MOTION is the `.handgrant` CSS animation (`tohandfly`).
 * It SELF-CLEANS on `animationend` (with a fallback timer), so `fill: forwards` never parks a stuck card at
 * the slide-end position (the owner-reported bottom-left ghost). Owner ask 2026-07-21; shared by both phases.
 */
export function HandGrantCard({ view, onDone }: { view: CardView; onDone?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    fireCardShine(el, (cx, cy, w, h) => pixiFx.cardShine(cx, cy, w, h, getCardToHandFxConfig()));
    // Remove when the motion finishes. Fallback timer covers a browser that never fires animationend (or an
    // instant-completing animation), so a card is never left parked at its slide-end frame.
    const c = getCardToHandFxConfig();
    const total = c.popMs + c.settleMs + c.holdMs + c.slideMs;
    const end = (): void => onDone?.();
    el.addEventListener('animationend', end, { once: true });
    const fallback = window.setTimeout(end, total + 250);
    return () => { el.removeEventListener('animationend', end); window.clearTimeout(fallback); };
  }, [onDone]);

  return (
    <div className="handgrant" ref={ref} aria-hidden="true">
      <span className="hg-label">To your hand</span>
      <Card card={view} suppressPop />
    </div>
  );
}
