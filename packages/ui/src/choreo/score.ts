import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import type { MomentKind } from './kinds';
import { playMomentSfx } from './channels/sfx';
import { spawnFloats, type Float, type DeathFloat } from './channels/float';

/**
 * The Score (choreographer phase 3) — per moment KIND, the ordered cues (channels + when they fire) that a
 * moment plays. Phase 3a shipped one channel (`sfx`, always `start`). Phase 3b adds `float` (also `start` —
 * a moment becoming current is already the right time to show its numbers/glyphs) and, for `attackExchange`
 * only, `lunge` (`start`) + `impact` (`contact` — a REAL anchor: a GSAP timeline position the lunge channel
 * defines, not a separately-computed hold value). `runMomentCues` is the plain-effect registry (sfx + float,
 * called once per moment from a `useEffect`); the `lunge`/`impact` pair is DOM-measuring/GSAP work, driven
 * instead by `engine.ts`'s `runAttackExchangeCues` from a `useLayoutEffect` — this file still owns the score
 * DATA for both.
 */
export type Channel = 'sfx' | 'float' | 'lunge' | 'impact';
/** When a cue fires within its moment. `start`/`contact` are used today; `landed`/`end` are reserved for
 *  phase 3c (aura bursts) and phase 4 (authoring). */
export type Anchor = 'start' | 'contact' | 'landed' | 'end';
export interface Cue { ch: Channel; at: Anchor; }

const SFX_FLOAT: Cue[] = [{ ch: 'sfx', at: 'start' }, { ch: 'float', at: 'start' }];
/** Every kind runs sfx + float at start (both adapters no-op for moments with nothing to show) EXCEPT
 *  `attackExchange`, which ALSO still needs sfx (the wind-up whoosh, `sfx.attack`) + float (absorbed
 *  windup events like Rally/buff can carry a float) at `start`, PLUS `lunge` (the motion) at `start` and
 *  `impact` (the smack/FX/recoil) at the `contact` anchor the lunge defines. Each kind gets its OWN array
 *  (not a shared reference) so a future authoring pass can vary one kind's cues without mutating others. */
export const SCORE: Record<MomentKind, Cue[]> = {
  attackExchange: [{ ch: 'sfx', at: 'start' }, { ch: 'float', at: 'start' }, { ch: 'lunge', at: 'start' }, { ch: 'impact', at: 'contact' }],
  damage: [...SFX_FLOAT], shieldPop: [...SFX_FLOAT], poisonTick: [...SFX_FLOAT],
  death: [...SFX_FLOAT], riseDeath: [...SFX_FLOAT], scCast: [...SFX_FLOAT],
  summon: [...SFX_FLOAT], buffWave: [...SFX_FLOAT], reborn: [...SFX_FLOAT], ascend: [...SFX_FLOAT],
  rally: [...SFX_FLOAT], toHand: [...SFX_FLOAT], maxGold: [...SFX_FLOAT], improve: [...SFX_FLOAT],
  keyword: [...SFX_FLOAT], hpGrant: [...SFX_FLOAT], reveal: [...SFX_FLOAT],
};

export interface CueContext {
  events: CombatEvent[];
  /** Called when a moment contains a real (non-Rise) death — the caller triggers the board shake. */
  onShake: () => void;
  /** Resolve a unit's live DOM node — used to position a killing-blow float in the board overlay. */
  findEl: (uid: string) => Element | null;
  /** The attacker whose OWN retaliation damage number is suppressed this moment (or null). */
  attackerUid: string | null;
  onFloats: (floats: Float[]) => void;
  onDeathFloats: (deaths: DeathFloat[]) => void;
}

/** Run one moment's plain-effect cues (sfx + float). The `lunge`/`impact` pair is DOM-measuring/GSAP work
 *  handled separately by `engine.ts`'s `runAttackExchangeCues` — this registry silently ignores cue kinds
 *  it doesn't own, so `attackExchange`'s `lunge`/`impact` entries are no-ops here (by design). */
export function runMomentCues(moment: Moment, ctx: CueContext): void {
  for (const cue of SCORE[moment.kind]) {
    if (cue.ch === 'sfx') {
      const { shake } = playMomentSfx(moment, ctx.events);
      if (shake) ctx.onShake();
    } else if (cue.ch === 'float') {
      const { floats, deathFloats } = spawnFloats(moment, ctx.events, ctx.findEl, ctx.attackerUid);
      if (floats.length) ctx.onFloats(floats);
      if (deathFloats.length) ctx.onDeathFloats(deathFloats);
    }
  }
}
