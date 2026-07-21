import { useEffect, useRef } from 'react';
import { Card, type CardView } from './Card';
import { pixiFx } from './pixiFx';
import { animateCardToHand, getCardToHandFxConfig } from './cardToHandFxConfig';

/**
 * The flying card shown when a card is sent to your hand (combat grant OR recruit-phase conjure). On mount it
 * runs the card-to-hand flourish once: the WAAPI snap/pop → ease → slide motion, plus the Pixi shine sweep +
 * sparkles over the card. Owner ask 2026-07-21. Shared by both phases so they read identically.
 */
export function HandGrantCard({ view }: { view: CardView }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    animateCardToHand(el, (cx, cy, w, h) => {
      const c = getCardToHandFxConfig();
      pixiFx.cardShine(cx, cy, w, h, c);
    });
  }, []);

  return (
    <div className="handgrant" ref={ref} aria-hidden="true">
      <span className="hg-label">To your hand</span>
      <Card card={view} suppressPop />
    </div>
  );
}
