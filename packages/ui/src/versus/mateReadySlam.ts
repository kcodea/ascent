import { playDef } from '../fx/playDef';
import { sfx } from '../sfx';

/**
 * YOUR TEAMMATE READIES UP (owner 2026-11-02: "add an animation when your teammate readies up during the shop round. i
 * want to copy the rune select slam effect when the rune is applied to their slot, but their lobby rail card should go
 * CHING! and thud and glow green with a green check mark icon in the top corner of their rail"; R-DUOS-MATE-READY-01).
 *
 * The moment the teammate's slice flips to Locked in during the shop: the rune arrival's implosion
 * (`rune-select-implosion`, the beat a rune plays when it lands in its tray slot) in green on the slice, the rune
 * arrival sound (the rune landing in its socket) under the owner's ding (the CHING, the loudest of the three) and a low
 * impact (the thud), while the slice itself punches in (CSS `.lobbyseat.slam`). The
 * green glow and the check chip are plain CSS on `.lobbyseat.mate-ready` and stay for as long as they are locked in.
 */

/** Rim to core: deep, mid and pale green, then white. */
export const MATE_READY_GREEN: readonly number[] = [0x0d6b2a, 0x22c55e, 0x8bf5a6, 0xffffff];

/** When the punch lands, ms after the flip (the CSS `lrvReadySlam` keyframe's impact): the thud rides it. */
export const MATE_READY_THUD_MS = 110;

/** Fire the slam on `el` (the teammate's slice). Measured now: the slice is laid out (it is on screen already). */
export function playMateReadySlam(el: Element | null | undefined): void {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return; // not on screen (a view swap, a pause): no burst on empty space
  const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  // Literal def id: the FX coverage map scans for literal `playDef` calls.
  playDef('rune-select-implosion', { source: at, target: at, cursor: at }, { scale: 0.7, recolor: MATE_READY_GREEN, recolorGlow: true, slot: 'over' });
  sfx.mateReadyDing(1);
  sfx.runeSelectImplosion(0.5);
  sfx.tallyImpact(0.7, MATE_READY_THUD_MS);
}
