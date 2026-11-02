import { useEffect, useRef } from 'react';
import type { EquipFx } from '@game/sim';
import { canPlayDefs, playDef } from './fx/playDef';

/**
 * THE AMPLIFIED EQUIPMENT SLOT (owner ask 2026-11-01: "redo the Amplified Equipment effect. Design a new one").
 *
 * Amplified = the selected Equipment's next activation triggers TWICE. Until 2026-11-01 a looping Pixi def
 * (`amplified-slot`, ~3.7k particles) rode the slot button. After three rounds of drafts the owner approved the
 * CHARGED look, which is now plain CSS on the slot (StatusBar's `.eq-amp-set`, styled in equipSlot.css): a breathing
 * blue halo, a thin second ring breathing out of phase, a glint travelling the rim and soft motes rising off the
 * sides. Compositor-only (opacity / transform), mounted only while it shows, no Pixi at all. The show rule is the one
 * the loop had (StatusBar, `ampShow`): the SELECTED Equipment will Amplify AND has a charge AND it is the Shop AND
 * nothing covers the slot.
 *
 * What is left here is the one Pixi part: the RELEASE flourish when the Amplified activation fires.
 */

/**
 * The slot button. `:not(.leaving)` skips the fade-out copy StatusBar keeps in the DOM for 260 ms after the real
 * slot is gone (`equipLeaving`), which must never be measured as the live slot. Also the anchor Rune of
 * Amplification's End-of-Turn burst plays on (`choreographer/equipmentFx.ts`).
 */
export const AMPLIFIED_SLOT_SELECTOR = '.statusbar .equipslot:not(.leaving) .heropowerbtn';

type Point = { x: number; y: number };

/** The live centre of the slot button, or null when it is not in the DOM / has no layout box this frame. */
function slotCentre(): Point | null {
  const el = document.querySelector<HTMLElement>(AMPLIFIED_SLOT_SELECTOR);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * THE RELEASE (owner ask 2026-11-01): the moment an Amplified activation FIRES, two soft blue rings leave the slot,
 * one per trigger (`amplified-release`). Gentle by owner direction: no cracks, no bursts.
 *
 * "An Amplified activation fired" is read off the two things StatusBar already has: the Equipment that WAS
 * Amplified on the previous render (`amplifiedId`, the same read that paints the charge blue), and a fresh
 * Equipment-use cue for that same Equipment on the per-action channel (`equipFxSeq` / `equipFx`). Both are needed:
 * a use of an unamplified Equipment is not a release, and the Amplification ending without a use (a swap, End of
 * Turn) is not one either. Mounting with a cue already on the channel fires nothing, and a re-render without a new
 * `seq` fires nothing, so each press releases once.
 *
 * Played at the slot button's centre, measured once at the fire (a one-shot: one layout read per press, none per
 * frame). Instant, not on the use def's tuner delay: it is the slot letting go of its charge as it is pressed.
 */
export function useAmplifiedReleaseFx(seq: number | undefined, cues: readonly EquipFx[] | undefined, amplifiedId: string | null): void {
  const seqRef = useRef(seq);
  const ampRef = useRef(amplifiedId);
  const stopsRef = useRef<Array<() => void>>([]);
  useEffect(() => {
    const wasAmplified = ampRef.current;
    ampRef.current = amplifiedId;
    if (seq === seqRef.current) return;
    seqRef.current = seq;
    if (!wasAmplified || !cues?.some((c) => c.kind === 'use' && c.equipmentId === wasAmplified)) return;
    if (!canPlayDefs()) return;
    const p = slotCentre();
    if (!p) return;
    const stop = playDef('amplified-release', { source: p, target: p, cursor: p });
    if (stop) stopsRef.current.push(stop);
  }, [seq, amplifiedId, cues]);
  // A one-shot retires on its own; unmount (a new run, the title) retires whatever is still playing.
  useEffect(() => () => { for (const f of stopsRef.current.splice(0)) f(); }, []);
}
