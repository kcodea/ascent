import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CARD_INDEX } from '@game/content';
import { Card } from '../Card';
import { toView } from '../MinionBook';
import { MinionSkinContext, type MinionSkinMap } from '../skins/skinArt';
import { refPopupLeft } from '../refPreviewPlacement';
import { rectToStage, stageHost, stageViewport, type StageRect } from '../stage';

/**
 * THE IN-GAME CARD PREVIEW for a card skin (owner 2026-09-30: "add a mouseover preview of what minions/spells
 * would look like in game"). Hovering a minion-skin tile (or the detail panel's art) floats the REAL `Card`, the
 * component the game renders, with the skin applied the way a game applies it: through `MinionSkinContext`, the same
 * `cardId -> art` map every `Card` reads in a run. It is the full, PLATED card (frame, tier stars, stats, name, rules
 * text on its carved plate: the look a card has in your hand and in the Compendium, the one way the game shows a
 * card's art AND its text together). Generic over the card's kind, so a spell skin (any skin whose target is a card)
 * previews as a spell card the day one exists.
 *
 * Placement happens ONCE per hover: the anchor's rect is read on pointer enter (by the caller), and the card's own
 * painted box (frame + plate, which overhang the card element) is measured once here, before paint, while the card
 * sits hidden. Then it is placed beside the anchor (right, else left, else centred), vertically centred on it and
 * clamped on screen, and never measured again. `pointer-events: none`, so it never steals the hover.
 */

/** The preview card's height in layout px (its width is the game's 0.752 card ratio). */
export const PREVIEW_CH = 340;
const PREVIEW_CW = Math.round(PREVIEW_CH * 0.752);
const GAP = 14;
const EDGE = 8;

/** The painted parts of a plated card, whose union is what the player sees (the plate and frame overhang `.card`). */
const PAINTED = '.card, .cardplate, img.cframe:not(.cshadow), .plate-tribe, .drawer';

export interface PreviewBox { w: number; h: number }

/** Where the preview's PAINTED box sits for an anchor (pure; exported for the test). */
export function previewPlacement(anchor: Pick<StageRect, 'left' | 'right' | 'top' | 'height'>, box: PreviewBox, viewport: { w: number; h: number }): { left: number; top: number } {
  const left = refPopupLeft({ cardLeft: anchor.left, cardRight: anchor.right, tipW: box.w, viewportW: viewport.w, gap: GAP, edge: EDGE });
  const centred = anchor.top + anchor.height / 2 - box.h / 2;
  const top = Math.max(EDGE, Math.min(centred, viewport.h - box.h - EDGE));
  return { left: Math.round(left), top: Math.round(top) };
}

const EMPTY_MAP: MinionSkinMap = new Map();

export const SkinCardPreview = memo(function SkinCardPreview({ cardId, art, anchor }: {
  cardId: string;
  /** The skin's art, or undefined for the card's default art. */
  art: string | undefined;
  anchor: StageRect;
}): JSX.Element | null {
  const def = CARD_INDEX[cardId];
  const view = useMemo(() => (def ? toView(def) : null), [def]);
  const skins = useMemo<MinionSkinMap>(() => (art ? new Map([[cardId, art]]) : EMPTY_MAP), [cardId, art]);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // ONE measurement per hover (the parent keys this component by hover), before paint: the painted box relative to
  // the wrapper, then the placement. jsdom has no layout, so a zero box falls back to the card's nominal size.
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const hr = rectToStage(host.getBoundingClientRect());
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const el of host.querySelectorAll(PAINTED)) {
      const x = rectToStage(el.getBoundingClientRect());
      if (!x.width || !x.height) continue;
      l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); b = Math.max(b, x.bottom);
    }
    const measured = Number.isFinite(l) && r > l && b > t;
    const box = measured ? { w: r - l, h: b - t } : { w: PREVIEW_CW, h: PREVIEW_CH };
    const at = previewPlacement(anchor, box, stageViewport());
    setPos(measured ? { left: Math.round(at.left - (l - hr.left)), top: Math.round(at.top - (t - hr.top)) } : at);
  }, [anchor]);

  if (!view) return null;
  const style = {
    left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? undefined : 'hidden',
    '--ch': `${PREVIEW_CH}px`, '--cw': `${PREVIEW_CW}px`, '--ccw': `${Math.round(PREVIEW_CW * 0.85)}px`,
  } as CSSProperties;
  return createPortal(
    <div ref={ref} className="colls-cardpreview" style={style} aria-hidden data-card-preview={cardId}>
      <MinionSkinContext.Provider value={skins}>
        <Card card={view} forceFull suppressPop plated />
      </MinionSkinContext.Provider>
    </div>,
    stageHost(),
  );
});
