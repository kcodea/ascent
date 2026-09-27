/**
 * START OF TURN BEATS (owner 2026-09-26, oracle R-SOT-BEAT-01): "this also does not have a start of turn beat, please
 * wire one in and make sure we bake time for the screen wipe transition."
 *
 * A Start-of-Turn effect resolves inside `resolveCombat`, which the Shop dispatches while the return-to-shop curtain
 * fully covers the scene (`coveredOut`). Anything played at that moment plays UNDER the blue. So the sim records each
 * Start-of-Turn firing on its own channel (`RunState.sotBeatFx`, gated by `sotBeatFxSeq`) and this module plans how
 * the Shop presents it, DOM-free so the timing rules are testable:
 *
 *   · nothing plays until the wipe is fully at rest on a revealed Shop (`sotBeatsMayPlay`), plus a short pad so the
 *     first beat does not land on the reveal's last frame;
 *   · each firing source gets its OWN beat: the source pulses first (a hero source pulses the hero-power button), then
 *     every recipient's gain lands, one after another;
 *   · the recipients' shown stats are HELD at their pre-grant values (`holdSotGains`) and each is released on the cue
 *     that lands it (`releaseSotGain`), so the numbers rise on the beat instead of already being up when the curtain
 *     lifts. The hold is a DELTA off the real stats, so a Shop action taken mid-beat still shows correctly.
 *
 * Presentation only: the run state committed at `resolveCombat`; skipping or missing a beat changes nothing.
 */
import type { SotBeatFx } from '@game/sim';
import type { WipeState } from './wipeMachine';

/** Breath between the return wipe coming fully to rest and the first Start-of-Turn beat. */
export const SOT_POST_WIPE_PAD_MS = 300;
/** From a beat's source pulse to its first gain landing (the pulse reads first, then the payoff). */
export const SOT_PULSE_LEAD_MS = 260;
/** Between two recipients' gains inside one beat. */
export const SOT_GAIN_STAGGER_MS = 70;
/** After a beat's last gain, before the next beat's pulse. */
export const SOT_BEAT_TAIL_MS = 420;

/** A Start-of-Turn beat may play only on a REVEALED Shop: the recruit phase with the wipe fully idle. */
export function sotBeatsMayPlay(phase: string, wipe: WipeState): boolean {
  return phase === 'recruit' && wipe === 'idle';
}

export type SotCue =
  | { at: number; kind: 'pulse'; beat: number; source: SotBeatFx['source'] }
  | { at: number; kind: 'gain'; beat: number; source: SotBeatFx['source']; uid: string; attack: number; health: number };

/** The cue list for a batch of Start-of-Turn beats, in ms from the moment the wipe came to rest. Every cue sits at or
 *  after `SOT_POST_WIPE_PAD_MS`; beats never overlap (each waits for the previous one's tail). */
export function planSotBeats(beats: readonly SotBeatFx[]): { cues: SotCue[]; durationMs: number } {
  const cues: SotCue[] = [];
  let t = SOT_POST_WIPE_PAD_MS;
  beats.forEach((b, i) => {
    cues.push({ at: t, kind: 'pulse', beat: i, source: b.source });
    let last = t + SOT_PULSE_LEAD_MS;
    b.gains.forEach((g, j) => {
      last = t + SOT_PULSE_LEAD_MS + j * SOT_GAIN_STAGGER_MS;
      cues.push({ at: last, kind: 'gain', beat: i, source: b.source, uid: g.uid, attack: g.attack, health: g.health });
    });
    t = last + SOT_BEAT_TAIL_MS;
  });
  return { cues, durationMs: beats.length ? t : 0 };
}

export type SotHeld = Readonly<Record<string, { attack: number; health: number }>>;

/** Add a batch's gains to the held deltas (what the Shop subtracts from the real stats until each gain's cue). */
export function holdSotGains(prev: SotHeld | null, beats: readonly SotBeatFx[]): SotHeld | null {
  const out: Record<string, { attack: number; health: number }> = { ...(prev ?? {}) };
  for (const b of beats) {
    for (const g of b.gains) {
      const cur = out[g.uid] ?? { attack: 0, health: 0 };
      out[g.uid] = { attack: cur.attack + g.attack, health: cur.health + g.health };
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Release one landed gain from the hold (null once nothing is held). */
export function releaseSotGain(prev: SotHeld | null, uid: string, attack: number, health: number): SotHeld | null {
  const cur = prev?.[uid];
  if (!prev || !cur) return prev;
  const out: Record<string, { attack: number; health: number }> = { ...prev };
  const left = { attack: cur.attack - attack, health: cur.health - health };
  if (left.attack <= 0 && left.health <= 0) delete out[uid];
  else out[uid] = left;
  return Object.keys(out).length ? out : null;
}

/** The stats to SHOW for a board card while a Start-of-Turn gain is held off it (undefined = show the real stats). */
export function sotShownStats(held: SotHeld | null, uid: string, attack: number, health: number): { attack: number; health: number } | undefined {
  const d = held?.[uid];
  return d ? { attack: attack - d.attack, health: health - d.health } : undefined;
}
