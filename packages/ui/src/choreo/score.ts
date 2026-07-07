import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import type { MomentKind } from './kinds';
import { playMomentSfx } from './channels/sfx';

/**
 * The Score (choreographer phase 3) — per moment KIND, the ordered cues (channels + when they fire) that a
 * moment plays. This is the authoring surface phases 3b–4 enrich (offset/contact/landed anchors, per-kind
 * variation, staggers). Phase 3a ships one channel — `sfx` — fired at `start` for every kind; the per-EVENT
 * sound selection lives inside the adapter (`channels/sfx.ts`).
 */
export type Channel = 'sfx';
/** When a cue fires within its moment. Phase 3a: `start` only; offset/`contact`/`landed`/`end` anchors land
 *  with the GSAP cue-timeline engine in phase 3b. */
export type Anchor = 'start';
export interface Cue { ch: Channel; at: Anchor; }

/** Every kind runs the sfx channel at start (the adapter no-ops for moments with no sound-bearing events),
 *  reproducing the former "run the SFX effect on every beat" behavior. `Record<MomentKind, …>` forces a new
 *  kind to get an entry. Each kind gets its OWN cue array (not a shared reference) so phase 3b can vary one
 *  kind's cues without mutating the others. */
export const SCORE: Record<MomentKind, Cue[]> = {
  attackExchange: [{ ch: 'sfx', at: 'start' }],
  impact: [{ ch: 'sfx', at: 'start' }],
  death: [{ ch: 'sfx', at: 'start' }],
  riseDeath: [{ ch: 'sfx', at: 'start' }],
  scCast: [{ ch: 'sfx', at: 'start' }],
  summon: [{ ch: 'sfx', at: 'start' }],
  buffWave: [{ ch: 'sfx', at: 'start' }],
  reborn: [{ ch: 'sfx', at: 'start' }],
  ascend: [{ ch: 'sfx', at: 'start' }],
  rally: [{ ch: 'sfx', at: 'start' }],
  toHand: [{ ch: 'sfx', at: 'start' }],
  maxGold: [{ ch: 'sfx', at: 'start' }],
  improve: [{ ch: 'sfx', at: 'start' }],
  keyword: [{ ch: 'sfx', at: 'start' }],
  hpGrant: [{ ch: 'sfx', at: 'start' }],
  reveal: [{ ch: 'sfx', at: 'start' }],
};

export interface CueContext {
  events: CombatEvent[];
  /** Called when a moment contains a real (non-Rise) death — the caller triggers the board shake. */
  onShake: () => void;
}

/** Run one moment's scored cues. Phase 3a fires channels at `start`; the runner grows a real timeline in 3b.
 *  Phase 3b replaces the single `if (cue.ch === 'sfx')` branch with a channel-handler registry as more
 *  channels (float, anim, shake, …) land. */
export function runMomentCues(moment: Moment, ctx: CueContext): void {
  for (const cue of SCORE[moment.kind]) {
    if (cue.ch === 'sfx') {
      const { shake } = playMomentSfx(moment, ctx.events);
      if (shake) ctx.onShake();
    }
  }
}
