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

const SFX_AT_START: Cue[] = [{ ch: 'sfx', at: 'start' }];
/** Every kind runs the sfx channel at start (the adapter no-ops for moments with no sound-bearing events),
 *  reproducing the former "run the SFX effect on every beat" behavior. `Record<MomentKind, …>` forces a new
 *  kind to get an entry here. */
export const SCORE: Record<MomentKind, Cue[]> = {
  attackExchange: SFX_AT_START, impact: SFX_AT_START, death: SFX_AT_START, riseDeath: SFX_AT_START,
  scCast: SFX_AT_START, summon: SFX_AT_START, buffWave: SFX_AT_START, reborn: SFX_AT_START,
  ascend: SFX_AT_START, rally: SFX_AT_START, toHand: SFX_AT_START, maxGold: SFX_AT_START,
  improve: SFX_AT_START, keyword: SFX_AT_START, hpGrant: SFX_AT_START, reveal: SFX_AT_START,
};

export interface CueContext {
  events: CombatEvent[];
  /** Called when a moment contains a real (non-Rise) death — the caller triggers the board shake. */
  onShake: () => void;
}

/** Run one moment's scored cues. Phase 3a fires channels at `start`; the runner grows a real timeline in 3b. */
export function runMomentCues(moment: Moment, ctx: CueContext): void {
  for (const cue of SCORE[moment.kind]) {
    if (cue.ch === 'sfx') {
      const { shake } = playMomentSfx(moment, ctx.events);
      if (shake) ctx.onShake();
    }
  }
}
