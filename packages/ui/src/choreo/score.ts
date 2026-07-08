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
export type Channel = 'sfx' | 'float' | 'lunge' | 'impact' | 'auraBurst' | 'auraBreak' | 'auraReform';
/** When a cue fires within its moment. `start`/`contact` are used today; `landed`/`end` are reserved for
 *  phase 3c (aura bursts) and phase 4 (authoring). */
export type Anchor = 'start' | 'contact' | 'landed' | 'end';
export interface Cue {
  ch: Channel;
  at: Anchor;
  /** ms relative to the anchor (default 0). Negative allowed for contact/landed; start clamps ≥0 (later task). */
  offset?: number;
  /** Does `offset` scale with combatSpeed? default true; false = fixed wall-clock (the reborn re-form). */
  scaled?: boolean;
  /** default true; a disabled cue is skipped by the runner/engine. */
  enabled?: boolean;
}

const BASE: Cue[] = [
  { ch: 'sfx', at: 'start' },
  { ch: 'float', at: 'start' },
  { ch: 'auraBurst', at: 'start', offset: 0 },
  { ch: 'auraBreak', at: 'start', offset: 300, scaled: true },
];
const withReform = (): Cue[] => [...BASE, { ch: 'auraReform', at: 'start', offset: 460, scaled: false }];
/** Every kind runs sfx + float + auraBurst + auraBreak at start (all adapters no-op for moments with nothing
 *  to show) EXCEPT `attackExchange`, which ALSO still needs sfx (the wind-up whoosh, `sfx.attack`) + float
 *  (absorbed windup events like Rally/buff can carry a float) at `start`, PLUS `lunge` (the motion) at `start`
 *  and `impact` (the smack/FX/recoil) at the `contact` anchor the lunge defines, plus auraBurst/auraBreak (a
 *  death/shield grouped into an attack's absorbed-windup run must still burst/shatter). The aura sub-channels
 *  are on EVERY kind because `death`/`shield` are RESULT_TYPES that collapse into another kind's moment (e.g.
 *  `[dmg, death]` is a `damage`-kind moment CONTAINING a death) — gating them on death/shieldPop kinds would
 *  miss those grouped effects. `auraReform` (the reborn re-form glow) rides only on the `reborn` kind, since a
 *  reborn is never grouped into another kind's moment. The three aura sub-channels (`auraBurst` = a real death
 *  bursting its auras in place at offset 0; `auraBreak` = a Divine-Shield consume's delayed gold shatter at
 *  +300ms scaled; `auraReform` = a reborn re-form glow at +460ms fixed wall-clock) each carry their own offset
 *  so a later authoring pass can retime each independently. Each kind gets its OWN array (not a shared
 *  reference) so a future authoring pass can vary one kind's cues without mutating others. */
export const SCORE: Record<MomentKind, Cue[]> = {
  attackExchange: [
    { ch: 'sfx', at: 'start' }, { ch: 'float', at: 'start' },
    { ch: 'lunge', at: 'start' }, { ch: 'impact', at: 'contact', offset: 0 },
    { ch: 'auraBurst', at: 'start', offset: 0 }, { ch: 'auraBreak', at: 'start', offset: 300, scaled: true },
  ],
  damage: [...BASE], shieldPop: [...BASE], poisonTick: [...BASE],
  death: [...BASE], riseDeath: [...BASE], scCast: [...BASE],
  summon: [...BASE], buffWave: [...BASE], reborn: withReform(), ascend: [...BASE],
  rally: [...BASE], toHand: [...BASE], maxGold: [...BASE], improve: [...BASE],
  keyword: [...BASE], hpGrant: [...BASE], reveal: [...BASE],
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
  /** A REAL (non-Rise) death carrying auras → burst them (uid). Wired to channels/aura.ts's burstDeathAuras.
   *  Rise deaths are handled by the replay/engine (defender bursts in place; a pulled-home attacker bursts at
   *  the pull-back's `landed`), NOT here — the runner skips `rise` deaths. */
  onAuraBurst: (uid: string) => void;
  /** A Divine Shield was consumed this moment (uid) → the delayed gold shatter. */
  onShieldBreak: (uid: string) => void;
  /** A unit was reborn this moment (uid) → schedule the re-form glow. */
  onReborn: (uid: string) => void;
}

/** Run one moment's plain-effect cues (sfx + float). The `lunge`/`impact` pair is DOM-measuring/GSAP work
 *  handled separately by `engine.ts`'s `runAttackExchangeCues` — this registry silently ignores cue kinds
 *  it doesn't own, so `attackExchange`'s `lunge`/`impact` entries are no-ops here (by design). */
export function runMomentCues(moment: Moment, ctx: CueContext): void {
  for (const cue of SCORE[moment.kind]) {
    if (cue.enabled === false) continue;
    if (cue.ch === 'sfx') {
      const { shake } = playMomentSfx(moment, ctx.events);
      if (shake) ctx.onShake();
    } else if (cue.ch === 'float') {
      const { floats, deathFloats } = spawnFloats(moment, ctx.events, ctx.findEl, ctx.attackerUid);
      if (floats.length) ctx.onFloats(floats);
      if (deathFloats.length) ctx.onDeathFloats(deathFloats);
    } else if (cue.ch === 'auraBurst') {
      // a real (non-Rise) death anywhere in the moment bursts its auras in place. `death` with `rise` is
      // intentionally NOT handled here — a Rise DEFENDER bursts in place (replay), a pulled-home Rise ATTACKER
      // bursts at the engine's `landed` (see the phase-3c integration task).
      for (let i = moment.start; i < moment.end; i++) { const e = ctx.events[i]; if (e?.type === 'death' && !e.rise) ctx.onAuraBurst(e.target); }
    } else if (cue.ch === 'auraBreak') {
      for (let i = moment.start; i < moment.end; i++) { const e = ctx.events[i]; if (e?.type === 'shield') ctx.onShieldBreak(e.target); }  // DS consumed: delayed gold shatter
    } else if (cue.ch === 'auraReform') {
      for (let i = moment.start; i < moment.end; i++) { const e = ctx.events[i]; if (e?.type === 'reborn') ctx.onReborn(e.target); }  // reborn: re-form glow
    }
    // lunge/impact are engine-driven (runAttackExchangeCues) — no-op here, by design.
  }
}
