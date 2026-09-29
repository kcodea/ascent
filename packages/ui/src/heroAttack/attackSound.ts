/**
 * A hero attack's sound voices (moved out of the Blast, 2026-09-28, when Quake joined it): every cue plays one clip on
 * the `attack` fader with a gain, a pitch and optional window / fade / reverb tail; every voice is kept so a cancel
 * can stop them; clips are pre-warmed so the first cue of a session is not the one waiting for its decode; other
 * buses duck while the attack plays.
 */
import { duckSfxBuses, getFxClipBuffer, playTailedClip, type SfxHandle } from '../sfx';

export interface CueOpts { tail?: number; lenMs?: number; fadeMs?: number; startMs?: number; delayMs?: number }

export class AttackVoices {
  readonly voices: SfxHandle[] = [];
  private ducked = false;

  constructor(private readonly enabled: boolean) {}

  /** Decode every clip now. */
  warm(clips: readonly string[]): void {
    if (!this.enabled) return;
    for (const clip of clips) { try { if (clip) getFxClipBuffer(clip); } catch { /* no audio here */ } }
  }

  cue(clip: string, gain: number, rate: number, opts: CueOpts = {}): void {
    if (!this.enabled || !clip || !(gain > 0)) return;
    const tail = opts.tail ?? 0;
    const h = playTailedClip(clip, 'attack', {
      gain, rate, startMs: opts.startMs, lenMs: opts.lenMs, delayMs: opts.delayMs,
      tail: { fadeOutMs: opts.fadeMs ?? 0, reverbMix: tail, reverbSec: tail > 0 ? 0.6 : 0 },
    });
    if (h) this.voices.push(h);
  }

  /** Keep a voice made elsewhere (a synth) so a cancel stops it too. */
  keep(h: SfxHandle | null): void { if (h) this.voices.push(h); }

  /**
   * A riser placed so its climax lands exactly `windowMs` (real ms) from now: its tail when the clip is longer than
   * the window, a delayed start when shorter.
   */
  riser(clip: string, gain: number, rate: number, windowMs: number): void {
    // Silent voices never touch the audio engine (a lookup here would start loading the clip, and on a page with no
    // audio context yet, create one mid-attack).
    if (!this.enabled) return;
    const buf = (() => { try { return getFxClipBuffer(clip); } catch { return null; } })();
    const r = rate > 0 ? rate : 1;
    if (!buf) { this.cue(clip, gain, r); return; }
    const clipMs = buf.duration * 1000;
    const heard = windowMs * r; // clip-time consumed over the window
    if (clipMs > heard) this.cue(clip, gain, r, { startMs: clipMs - heard });
    else this.cue(clip, gain, r, { delayMs: windowMs - clipMs / r });
  }

  duck(factor: number): void {
    if (this.enabled && factor < 1) { duckSfxBuses(factor, 'combat'); this.ducked = true; }
  }

  unduck(): void { if (this.ducked) { duckSfxBuses(1); this.ducked = false; } }

  stopAll(): void { for (const v of this.voices) v.stop(); }
}
