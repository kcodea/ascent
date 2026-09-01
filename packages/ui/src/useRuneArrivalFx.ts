import { useEffect, useRef } from 'react';
import { playDef } from './fx/playDef';
import { badgeCenterOf } from './runeTriggerFx';
import { getRuneLockInConfig } from './runeLockInConfig';
import { sfx } from './sfx';

/**
 * THE RUNE ARRIVAL — the beat after the lock-in ceremony (owner ask 2026-08-31).
 *
 * *"after this, the fade happens and game screen goes back to normal. i want the rune that was selected to
 * play an animation and for the art to pop in at that moment."*
 *
 * The ceremony ends by handing the rune over: the layer unmounts, the board comes back, and THEN the badge
 * that has been sitting empty in the tray implodes into its art. That ordering is the whole point of the
 * beat — it is the rune arriving somewhere, not a second flourish on the ceremony.
 *
 * ── Why it is its own beat, and its own def ───────────────────────────────────────────────────────────────
 *
 * The ceremony plays in a portalled layer over the board at screen centre; this plays on a badge in the HUD,
 * seconds later, after that layer is gone. Nothing about the two can share a source, a timeline or a sound —
 * so they are two beats with their own defs (`rune-select-implosion`) and their own faders, which is also
 * what lets the owner tune the alignment between them rather than inside one blob.
 *
 * ── The anchor ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Measured on the NEXT FRAME, never now: the badge re-renders on the commit that flips the phase (its art
 * appears), so its box is only trustworthy after layout — the same rule `runeTriggerFx` follows and for the
 * same reason. `badgeCenterOf` returns null for a badge that is not in the DOM, and a null anchor SKIPS the
 * play rather than firing it at the corner.
 */
export interface RuneArrivalCue {
  runeId: string;
  occurrence: number;
  phase: 'pending' | 'arrived';
  seq: number;
}

/**
 * DEV-ONLY fallback anchor, for the tuner's playback.
 *
 * The playback exists so the owner can judge the alignment between the ceremony and the arrival, and it
 * plays three arbitrary runes that the run does not own — so the badge the beat is *about* does not exist,
 * and without this the preview would simply stop at the fade and hide the seam being tuned.
 *
 * Any real badge is a better preview target than a point in space (it shows the beat at badge scale, where
 * it will actually live), so the first one on screen is used, and the tray itself is the last resort.
 *
 * Returns null in PRODUCTION, always. In live play the badge is guaranteed — the rune was bought before the
 * ceremony started — so a missing one means the screen changed, and firing at a stand-in would be a burst on
 * an innocent bystander. That is exactly what the choreography rules warn about, and it is why this cannot
 * be a plain fallback for both paths.
 */
function previewAnchor(): { x: number; y: number } | null {
  if (!import.meta.env.DEV) return null;
  const el = document.querySelector<HTMLElement>('.runebadge') ?? document.querySelector<HTMLElement>('.questbadges');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Fire the implosion on the arriving rune's badge, once per arrival.
 *
 * Keyed on `seq` rather than on the cue object: the phase flip is a new object every time, and a re-render
 * for any other reason must not re-fire an effect that has already played.
 */
export function useRuneArrivalFx(cue: RuneArrivalCue | null): void {
  const firedSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!cue || cue.phase !== 'arrived') return;
    if (firedSeq.current === cue.seq) return; // already played for this arrival
    firedSeq.current = cue.seq;

    const t = getRuneLockInConfig();
    let raf = 0;
    let timer = 0;
    const fire = (): void => {
      // The badge's live centre. It has just gained its art, so this reads the box the player is looking at
      // rather than the empty one it had a frame ago.
      const at = badgeCenterOf(cue.runeId, cue.occurrence) ?? previewAnchor();
      if (!at) return; // the badge left the DOM (screen changed, run ended) before the beat could land
      // The def id is written as a LITERAL, not a constant: the FX coverage map is built by scanning for
      // literal `playDef` calls, and a constant would file this beat under `<dynamic>` and hide it from the
      // library. Authored by the owner in the workbench, published 2026-08-31.
      playDef('rune-select-implosion', {
        source: at, target: at, cursor: at,
        camera: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      });
      sfx.runeSelectImplosion(t.arriveSfxVolume, t.arriveSfxDelayMs);
    };
    // `arriveDelayMs` is measured from the ceremony's END, and this hook runs on the commit that marks it —
    // so the dial is simply a delay from here.
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (t.arriveDelayMs > 0) timer = window.setTimeout(fire, t.arriveDelayMs);
      else fire();
    });
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      if (timer !== 0) window.clearTimeout(timer);
    };
  }, [cue]);
}
