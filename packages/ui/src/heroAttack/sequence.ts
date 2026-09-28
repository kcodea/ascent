/**
 * THE ONE CLOCK every hero attack runs on (moved out of the Blast, 2026-09-28, when Quake joined it).
 *
 * The numbers (DOM), the camera, the portraits, the Pixi scene and the sound cues all read one sequence clock advanced
 * per frame by `dt x speed`, which is why the consequence, the flash and the damage number can never drift apart, and
 * why slow motion and `finish()` are exact. The clock NEVER stops (owner 2026-09-28: "remove the freezeing frame from
 * all of the animations. it looks like lag"): there is no hit-stop and no freeze on a beat; weight comes from the
 * flash, the squash and knockback, the shake, the particles and the sound.
 *
 * The CONSEQUENCE (`onImpact`) fires exactly once: on the impact cue, or from `finish()` / the safety timer if the
 * sequence never got there (a hidden tab); never from `cancel()` (leaving the fight, as Classic's timers are cleared).
 * After the end, the updater keeps ticking only while the Pixi scene drains, then unhooks and unmounts it.
 */
export interface SequenceCue { at: number; kind: string; i: number }

export interface SequenceScene { update(dtMs: number): boolean; destroy(): void }

export interface SequenceOptions<Q extends SequenceCue> {
  /** Every beat, in time order; one of kind `end`. */
  cues: readonly Q[];
  speed: number;
  /** A beat fires. The style calls `land()` from its impact beat. */
  fire: (q: Q) => void;
  /** Paint the DOM (numbers, camera, portraits) for the current time. Not called once done. */
  paint: (t: number) => void;
  scene: SequenceScene | null;
  unmount: (() => void) | null;
  frames: (fn: (dtMs: number) => void) => () => void;
  /** Real ms after which the safety timer finishes the sequence (null = no timer). */
  safetyMs: number | null;
  onImpact: () => void;
  onDone?: () => void;
  /** Take the DOM down (numbers, camera, portraits, duck). */
  teardownDom: () => void;
  stopVoices: () => void;
}

export class Sequence<Q extends SequenceCue> {
  private tNow = 0;
  private cueIdx = 0;
  private impactedF = false;
  private doneF = false;
  private ended = false;
  private unhook: (() => void) | null = null;
  private safety = 0;

  constructor(private readonly o: SequenceOptions<Q>) {
    this.unhook = o.frames(this.step);
    if (o.safetyMs !== null && typeof window !== 'undefined') {
      this.safety = window.setTimeout(() => { if (!this.doneF) { this.complete(); this.teardownPixi(); } }, o.safetyMs);
    }
  }

  get t(): number { return this.tNow; }
  get impacted(): boolean { return this.impactedF; }
  get done(): boolean { return this.doneF; }

  /** Land the consequence (once). */
  land(): void { if (this.impactedF) return; this.impactedF = true; this.o.onImpact(); }

  private readonly teardownPixi = (): void => {
    this.unhook?.(); this.unhook = null;
    if (this.o.scene) { this.o.unmount?.(); this.o.scene.destroy(); }
  };

  private complete(): void {
    if (this.doneF) return;
    this.land();
    this.doneF = true;
    if (this.safety) window.clearTimeout(this.safety);
    this.o.teardownDom();
    this.o.onDone?.();
  }

  private readonly step = (dtMs: number): void => {
    const { o } = this;
    if (this.doneF && !o.scene) return;
    const adv = Math.max(0, Math.min(100, dtMs)) * o.speed;
    if (!this.doneF) {
      this.tNow += adv;
      while (this.cueIdx < o.cues.length && o.cues[this.cueIdx]!.at <= this.tNow) {
        const q = o.cues[this.cueIdx++]!;
        if (q.kind === 'end') this.ended = true;
        o.fire(q);
      }
      o.paint(this.tNow);
    }
    const alive = o.scene ? o.scene.update(this.doneF ? Math.max(0, Math.min(100, dtMs)) * o.speed : adv) : false;
    if (this.ended && !this.doneF) this.complete();
    // Keep ticking after the end only while Pixi particles drain; then unhook.
    if (this.doneF && !alive) this.teardownPixi();
  };

  /** Jump to the end: land the blow if it has not landed, clean up, fire onDone. */
  finish(): void { if (!this.doneF) this.complete(); this.teardownPixi(); }

  /** Stop and clean up WITHOUT landing. */
  cancel(): void {
    if (this.safety) window.clearTimeout(this.safety);
    this.doneF = true;
    this.o.stopVoices();
    this.o.teardownDom();
    this.teardownPixi();
  }
}
