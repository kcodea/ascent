import { useLayoutEffect, type RefObject } from 'react';
import { fitRefPopup } from './refPreviewPlacement';
import { stageViewport, toStage } from './stage';

/** An open hover-preview popup's placement, plus the anchor it was opened against (all STAGE px). */
export interface RefPopupPos {
  left: number;
  top: number;
  origin: 'left' | 'right';
  /** The hovered element's left/right edges, and the top the surface prefers before clamping. */
  anchorLeft: number;
  anchorRight: number;
  prefTop: number;
  /** Set once the measured pass has run, so the popup is measured ONCE per open, never again. */
  fitted?: boolean;
}

/**
 * Keep an open hover-preview chain (`.cardref`) fully on screen. The surface opens the popup from an estimate;
 * this measures the MOUNTED popup once, before paint (`useLayoutEffect`), and re-places it with the real width and
 * height via `fitRefPopup` (right if it fits, else left, else centred; top clamped). One `getBoundingClientRect`
 * per open (plus none after: `fitted` stops it), never per frame. Shared by every `.cardref` surface — card hover
 * (shop / hand / warband), the Runeforge rune cards, quest cards and the hero-power preview — so they can't drift.
 */
export function useFitRefPopup<P extends RefPopupPos>(
  popRef: RefObject<HTMLElement | null>,
  pos: P | null,
  setPos: (p: P) => void,
): void {
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!pos || pos.fitted || !el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const vp = stageViewport();
    const fit = fitRefPopup({
      anchorLeft: pos.anchorLeft, anchorRight: pos.anchorRight, prefTop: pos.prefTop,
      w: toStage(r.width), h: toStage(r.height), viewportW: vp.w, viewportH: vp.h,
    });
    // Unchanged → leave state alone (no extra render); the effect only re-runs when `pos` changes anyway.
    if (Math.abs(fit.left - pos.left) <= 0.5 && Math.abs(fit.top - pos.top) <= 0.5 && fit.origin === pos.origin) return;
    setPos({ ...pos, ...fit, fitted: true });
  }, [pos]);
}
