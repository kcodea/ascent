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
  /** The run the rune was bought in (`seed:heroId`). A cue never lights a badge on another run's screen (the Duos
   *  teammate view puts THEIR run in the store, R-RUNE-ARRIVAL-ONCE-01). Absent only on an older caller. */
  runKey?: string;
}

/**
 * ── ONCE PER ARRIVAL, ACROSS MOUNTS (R-RUNE-ARRIVAL-ONCE-01) ──────────────────────────────────────────────
 *
 * Owner report 2026-11-02: *"going back and forth sometimes causes runes to "trigger" as if they were just
 * equipped. like ninefold broker's keeps triggering"*.
 *
 * The cue stays in the store after it has played (nothing clears it), and the badge row REMOUNTS with the
 * StatusBar, which is keyed on the run identity: the Duos teammate view swaps the store's run to theirs and back,
 * and a replay seek bumps the key too. The "already played" memory used to be a ref, so it died with the mount,
 * and every remount replayed the last bought rune's implosion, sound and art pop. It is MODULE state now, keyed
 * by the cue's run and seq, so it outlives any mount. Seqs only grow within a session (`setRuneArrival`).
 */
const playedArrivals = new Set<string>();
const arrivalKey = (cue: RuneArrivalCue): string => `${cue.runKey ?? ''}#${cue.seq}`;

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
 * for any other reason must not re-fire an effect that has already played. Returns the cue THIS mount should
 * present (the badge classes read it): null for another run's cue, or for an arrival an earlier mount played.
 */
export function useRuneArrivalFx(rawCue: RuneArrivalCue | null, runKey: string): RuneArrivalCue | null {
  // The arrival THIS mount played. Its badge keeps the `rune-arrived` class (the art pop is mid-flight) on this
  // mount's later renders, but a fresh mount of the same arrival shows the badge plain.
  const ownKey = useRef<string | null>(null);
  const cue = rawCue
    && (rawCue.runKey === undefined || rawCue.runKey === runKey) // another run's cue (teammate view, a new run)
    && !(rawCue.phase === 'arrived' && playedArrivals.has(arrivalKey(rawCue)) && ownKey.current !== arrivalKey(rawCue))
    ? rawCue : null;
  useEffect(() => {
    if (!cue || cue.phase !== 'arrived') return;
    const key = arrivalKey(cue);
    if (playedArrivals.has(key)) return; // already played for this arrival, on this mount or an earlier one
    playedArrivals.add(key);
    ownKey.current = key;

    const t = getRuneLockInConfig();
    let raf = 0;
    let timer = 0;
    let fired = false;
    const fire = (): void => {
      fired = true;
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
      // Unmounted before the beat could land: it never played, so the next mount may still play it.
      if (!fired) { playedArrivals.delete(key); if (ownKey.current === key) ownKey.current = null; }
    };
  }, [cue]);
  return cue;
}
