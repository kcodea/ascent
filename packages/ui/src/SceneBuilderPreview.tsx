import { useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import type { RuneDef } from '@game/core';
import type { RunState, ShopCard } from '@game/sim';
import { Card, type CardView } from './Card';
import { RuneCard } from './RuneCard';
import { liveOptsFromRun, shopView } from './Recruit';

/** What the Scene Builder's library is hovering / focusing: one row, and the rect to seat the preview beside. */
export type SbPreviewTarget =
  | { kind: 'card'; id: string; anchor: DOMRect }
  | { kind: 'rune'; id: string; anchor: DOMRect };

const RUNE_INDEX: Record<string, RuneDef> = Object.fromEntries([...RUNES, ...EPIC_RUNES].map((r) => [r.id, r]));

/**
 * The library's hover preview — the REAL in-game card (`Card`, as the shop draws it: art, frame, tribe
 * plate, keyword pills, live text) or the REAL Runeforge tablet (`RuneCard`), floated beside the hovered
 * row. ONE element, portalled to `<body>`, re-targeted as the pointer moves — never a per-row mount.
 *
 * Text is the shop's live chain (`shopView` over `liveOptsFromRun`, the very builder the tavern uses), so a
 * scaling card previews its current value in THIS sandbox; stats are the PRINTED ones (the tavern's shop
 * buffs are stripped) because the row is the card definition, not an offer.
 *
 * Placement: to the right of the row, flipped to its left when that would leave the viewport, clamped
 * vertically — measured once per target in a layout effect and written straight to the element's style (no
 * per-frame layout reads). `pointer-events: none` so it can never steal the row's hover.
 */
export function SceneBuilderPreview({ target, run }: { target: SbPreviewTarget | null; run: RunState | null }) {
  const ref = useRef<HTMLDivElement | null>(null);

  const view = useMemo<CardView | null>(() => {
    if (!target || target.kind !== 'card' || !run) return null;
    const def = CARD_INDEX[target.id];
    if (!def) return null;
    const v = shopView({ uid: 'sb-preview', cardId: def.id } as ShopCard, liveOptsFromRun(run));
    // Printed stats, live text: the shop's view adds this run's tavern buffs to the offer, which a library
    // row is not. (Spells carry no stat footer — untouched.)
    return def.spell ? v : { ...v, attack: def.attack, health: def.health, baseAttack: def.attack, baseHealth: def.health, buffs: undefined, costChanged: false };
  }, [target, run]);
  const rune = target?.kind === 'rune' ? RUNE_INDEX[target.id] : undefined;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !target) return;
    const gap = 12;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const a = target.anchor;
    const fitsRight = a.right + gap + w <= window.innerWidth - 8;
    const left = fitsRight ? a.right + gap : Math.max(8, a.left - gap - w);
    const top = Math.max(8, Math.min(a.top - 8, window.innerHeight - h - 8));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.visibility = 'visible';
  }, [target]);

  if (!target || (!view && !rune)) return null;
  return createPortal(
    <div ref={ref} className="sb-preview" style={{ visibility: 'hidden' }} aria-hidden data-testid="sb-preview">
      <div className={`sb-preview-inner${rune ? ' rune' : ''}`}>
        {view && <Card card={view} forceFull suppressPop plated />}
        {rune && <RuneCard rune={rune} affordable onBuy={() => {}} />}
      </div>
    </div>,
    document.body,
  );
}
