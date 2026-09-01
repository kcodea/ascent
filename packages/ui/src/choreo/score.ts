import type { CombatEvent } from '@game/core';
import { ALE_IDS } from '@game/core';
import type { Moment } from './compile';
import type { MomentKind } from './kinds';
import { playMomentSfx } from './channels/sfx';
import { spawnFloats, type Float, type DeathFloat } from './channels/float';
import { groupBuffCasts } from './channels/buffCast';
import { groupSelfBuffs } from './channels/buffSelf';
import { rubiedLandsIn, RUBY_BEAT_MS, RUBY_GAP_MS } from './channels/rubyLanded';
import {
  ralliesFiredIn, rallyLeadMs, RALLY_GAP_MS, RALLY_PROC_STRIDE_MS, RALLY_PULSE_READ_MS,
  type RallyFired,
} from './channels/rallyFired';
import { releaseSummons } from '../fx/summonHold';
import { getLungeConfig } from '../lungeConfig';
import type { FxBinding } from './bindings';
import { cascade, scheduleLands } from '../fx/land';
import { claimOrHold } from '../fx/statHold';
import { canPlayDefs, playDef } from '../fx/playDef';
import { sfx } from '../sfx';
import { anchorsForUnits } from '../fx/combatAnchors';
import { claimDamageFx, damagedUidsIn, struckUidsIn, expireDamageFxClaim, isDamageFxClaimed } from './cardFx';
import { bindingFor } from './bindings';

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
export type Channel = 'sfx' | 'float' | 'lunge' | 'impact' | 'auraBurst' | 'auraBreak' | 'auraReform' | 'buffCast' | 'buffSelf' | 'improveSelf' | 'coins' | 'damageFx' | 'summonFx' | 'ascendFx' | 'executeFx' | 'fxDef' | 'rubyFx' | 'rallyFx';
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
  // `executeFx` is on EVERY kind for the same reason the aura channels are: `poison` is a RESULT_TYPE, so it
  // collapses into whatever moment it lands in (an Execute kill on an attack is an `attackExchange` moment,
  // NOT a `poisonTick` one). Scoring it on `poisonTick` alone meant it never fired for the common case —
  // owner report 2026-07-22. The runner SKIPS it on `attackExchange`, where the impact channel fires the
  // strike at the lunge's real contact point instead (and replaces the standard hit FX doing it).
  { ch: 'executeFx', at: 'start', offset: 0 },
  // `fxDef` is on EVERY kind as a pure TIMING row, carrying no def of its own — what plays comes from
  // `bindings.json` via `bindingFor`. It used to be added per-kind, which meant binding a def to a kind whose
  // cue list happened not to include one silently played nothing: another instance of the failure mode this
  // whole subsystem keeps producing. Inert wherever nothing is bound, and free wherever defs can't play (the
  // runner checks `canPlayDefs()` before it allocates anything). It sits BEFORE `damageFx` on purpose —
  // an authored effect claims the units it covers synchronously, and the claim has to be standing before the
  // stock hit-burst reads it.
  { ch: 'fxDef', at: 'start', offset: 0 },
  // `rallyFx` is on EVERY kind for the same reason `executeFx` is, and it is the more extreme case: a `rally`
  // event is an `onAttack` trigger, so `absorbIntoWindup` folds it into the ATTACKER'S exchange and the `rally`
  // KIND never occurs in a real fight. A binding reached through the primary event (the `fxDef` row above)
  // therefore could not see a Rally at all — which is why `kinds.rally` sat authored and unplayed until
  // 2026-08-04. This row scans the moment's own events instead. See `channels/rallyFired.ts`.
  { ch: 'rallyFx', at: 'start', offset: 0 },
];
const withReform = (): Cue[] => [...BASE, { ch: 'auraReform', at: 'start', offset: 460, scaled: false }];
/** Every kind runs sfx + float + auraBurst + auraBreak + executeFx + fxDef at start (all adapters no-op for
 *  moments with nothing to show) EXCEPT `attackExchange`, which ALSO still needs sfx (the wind-up whoosh,
 *  `sfx.attack`) + float (absorbed windup events like Rally/buff can carry a float) at `start`, PLUS `lunge`
 *  (the motion) at `start` and `impact` (the smack/FX/recoil) at the `contact` anchor the lunge defines, plus
 *  auraBurst (a death grouped into an attack's absorbed-windup run must still burst in place) and `fxDef` (a
 *  self-buff absorbed into a wind-up produces no `buffWave` moment of its own). A Ward CONSUMED
 *  by the exchange has no `auraBreak` cue here — the engine shatters it at the lunge's real `contact` (see
 *  `onImpactAuras`). The aura sub-channels are on EVERY kind because `death`/`shield` are RESULT_TYPES that
 *  collapse into another kind's moment (e.g. `[dmg, death]` is a `damage`-kind moment CONTAINING a death) —
 *  gating them on death/shieldPop kinds would miss those grouped effects. `auraReform` (the reborn re-form
 *  glow) rides only on the `reborn` kind, since a reborn is never grouped into another kind's moment. The three
 *  aura sub-channels (`auraBurst` = a real death bursting its auras in place at offset 0; `auraBreak` = a
 *  Divine-Shield consume's delayed gold shatter at +300ms scaled; `auraReform` = a reborn re-form glow at
 *  +460ms fixed wall-clock) each carry their own offset so a later authoring pass can retime each
 *  independently. Each kind gets its OWN array (not a shared reference) so a future authoring pass can vary
 *  one kind's cues without mutating others.
 *
 *  WHICH def each kind plays is NOT here — it lives in `bindings.json` (see `bindings.ts`). This table is
 *  timing only. */
export const SCORE_DEFAULTS: Record<MomentKind, Cue[]> = {
  attackExchange: [
    { ch: 'sfx', at: 'start' }, { ch: 'float', at: 'start' },
    { ch: 'lunge', at: 'start' }, { ch: 'impact', at: 'contact', offset: 0 },
    // NB: no `auraBreak` here — a Ward consumed by THIS exchange shatters at the lunge's real `contact` position
    // (engine-driven, `onImpactAuras`), not on a fixed start-relative delay that drifted off the hit and left the
    // bubble lingering disjointed from the unit. `auraBurst` (a death's in-place burst) stays at start.
    { ch: 'auraBurst', at: 'start', offset: 0 },
    // Self-buffs ABSORBED into a wind-up (`absorbIntoWindup` in compile.ts) never produce a `buffWave` moment
    // of their own — a Target Dummy growing as it is hit is exactly this case, which is why `attackExchange`
    // carries an fxDef row at all. (The binding itself is in `bindings.json`.)
    { ch: 'fxDef', at: 'start', offset: 0 },
    { ch: 'rubyFx', at: 'start', offset: 0 },
    // The kind a Rally actually arrives in — every Rally is an `onAttack` trigger, so `absorbIntoWindup` folds
    // its event into this exchange. If `rallyFx` were on only one kind, this would be the one.
    { ch: 'rallyFx', at: 'start', offset: 0 },
  ],
  // `damageFx` = a NON-melee hit burst (damageBurst + impact ring) at each dmg target. On `damage` (SC nukes,
  // split damage) and `death` (Blaster's Deathrattle AoE lands in its death moment). Melee dmg stays in
  // `attackExchange` (already has the full lunge/impact FX), so it never double-bursts; the handler no-ops on a
  // plain death that carries no dmg events.
  damage: [...BASE, { ch: 'damageFx', at: 'start', offset: 0 }], shieldPop: [...BASE], poisonTick: [...BASE],
  // `shieldGain` = a unit GAINS a Ward mid-combat (`shieldUp`); `venomSpent` = a Venomous charge SPENT, split
  // out of `poisonTick` (the Execute proc), which keeps its crescent strike untouched. Each new kind's cue
  // list is now IDENTICAL to its predecessor's — the splits cost the timing nothing, because what a kind
  // PLAYS is a binding rather than a cue.
  shieldGain: [...BASE], venomSpent: [...BASE],
  death: [...BASE, { ch: 'damageFx', at: 'start', offset: 0 }], riseDeath: [...BASE],
  // A real Start-of-Combat CAST (`sc` with `cast: true`) vs. mid-combat NARRATION, which classifies as
  // `scNarrate` and stays unbound so a spell-power line is silent.
  scCast: [...BASE], scNarrate: [...BASE],
  // `summonFx` = a dust poof at the arriving unit, at +250ms (scaled) to land on the `summonpop` overshoot (the
  // "bounce") — by then the scale-in has grown the unit to a measurable, full size.
  summon: [...BASE, { ch: 'summonFx', at: 'start', offset: 250 }],
  // `rubyFx` = the Ruby-landed detonation, on every kind a Ruby buff can surface in. It is a CHANNEL and not
  // an `fxDef` binding because `kinds` holds one binding per kind and both of these already spend theirs on
  // the self-buff cue — and because a Ruby is a game event with its own meaning, like `summonFx`, rather than
  // a per-card authored flourish. `attackExchange` is on the list for the same reason it carries `fxDef`:
  // `absorbIntoWindup` folds a Ruby played mid-swing (Crownvein's Rally) into the exchange, where a
  // `buffWave`-only cue would never see it.
  buffWave: [...BASE, { ch: 'buffCast', at: 'start', offset: 0 }, { ch: 'buffSelf', at: 'start', offset: 0 }, { ch: 'rubyFx', at: 'start', offset: 0 }],
  reborn: withReform(),
  ascend: [...BASE, { ch: 'ascendFx', at: 'start', offset: 0 }],
  rally: [...BASE], toHand: [...BASE],
  maxGold: [...BASE, { ch: 'coins', at: 'start', offset: 0 }],
  improve: [...BASE, { ch: 'improveSelf', at: 'start', offset: 0 }],
  keyword: [...BASE], keywordLost: [...BASE],
  hpGrant: [...BASE], spellProgress: [...BASE], reveal: [...BASE],
  tribeAura: [...BASE], // the wash itself is fired from the per-beat scan in useCombatReplay (like spell power), not a choreo channel
  // Quest/rune beats. These were classified `damage` before their kinds existed, so they carry `damage`'s exact
  // cue list — the split is provably a no-op for everything that already played. `damageFx` rides along INERT:
  // it bursts at the moment's `dmg` events and a quest moment is a single non-result event, so it has none.
  // Anchors: neither event names a unit (`flag`/`questId` + `side`), so `anchorsForUnits(null, null)` returns
  // null and the def skips silently — so although `bindings.json` binds a def at both kinds, the two stay
  // DORMANT until the score can anchor them to a badge/HUD node rather than a board unit.
  questTrigger: [...BASE, { ch: 'damageFx', at: 'start', offset: 0 }],
  questComplete: [...BASE, { ch: 'damageFx', at: 'start', offset: 0 }],
};

const KEY = 'ascent.choreoScore';
/** Sparse overrides: kind → channel → partial cue patch. The in-memory `overrides` var is the source of
 *  truth (works with no localStorage); localStorage is persistence only, read once at module load. */
type Overrides = Partial<Record<MomentKind, Partial<Record<Channel, Partial<Cue>>>>>;
let overrides: Overrides = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Overrides;
  } catch {
    return {};
  }
})();

/** The effective score: defaults with per-cue overrides merged in (matched by channel within a kind). Builds
 *  a fresh object each call — callers that read per moment should call it ONCE and iterate the result. */
export function getScore(): Record<MomentKind, Cue[]> {
  const out = {} as Record<MomentKind, Cue[]>;
  for (const kind of Object.keys(SCORE_DEFAULTS) as MomentKind[]) {
    const ov = overrides[kind];
    out[kind] = SCORE_DEFAULTS[kind].map((c) => (ov?.[c.ch] ? { ...c, ...ov[c.ch] } : c));
  }
  return out;
}
export function getCues(kind: MomentKind): Cue[] {
  return getScore()[kind];
}
export function setCue(kind: MomentKind, ch: Channel, patch: Partial<Cue>): void {
  overrides = { ...overrides, [kind]: { ...overrides[kind], [ch]: { ...overrides[kind]?.[ch], ...patch } } };
  try {
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {
    /* ignore */
  }
}
export function resetScore(): void {
  overrides = {};
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
export function scoreJson(): string {
  return JSON.stringify(getScore(), null, 2);
}

export interface CueContext {
  events: CombatEvent[];
  /** uid→cardId for the fought board — lets the sfx channel play a dying unit's own death voiceline
   *  (cards/<id>.death.mp3). Optional: absent in non-combat callers / older tests. */
  cardIds?: Map<string, string>;
  /** The player's in-combat speed slider — a scaled cue's offset is divided by this before scheduling. */
  combatSpeed: number;
  /** Called when a moment contains a real (non-Rise) death — the caller triggers the board shake. */
  onShake: () => void;
  /** A unit's LAYOUT-frame centre + footprint (the caller's `layoutRectOf` reading — the SLOT, not a
   *  mid-lunge position), or null when it isn't measurable. Every float is positioned in the board-level
   *  overlay from ONE reading taken here at spawn — see `spawnFloats`. */
  slotRectOf: (uid: string) => { cx: number; cy: number; w: number; h: number } | null;
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
  /** This moment's `poison` targets — minions destroyed by an Execute proc. The replay fires the Execution
   *  Strike crescent at each victim's slot. */
  onExecuteFx: (uids: string[]) => void;
  /** This moment's buff-OTHER casts (source !== target), grouped per (source,target). The replay fires a
   *  tendril per cast (Task 4 adds the held-value release / badge flash at the strike). */
  onBuffCasts: (casts: import('./channels/buffCast').BuffCast[]) => void;
  /** This moment's SELF-buffs (source === target), grouped per uid. The replay fires a pulse per unit and holds
   *  then flashes its badge to the new value (Task 6). */
  onSelfBuffs: (selfBuffs: import('./channels/buffSelf').SelfBuff[]) => void;
  /** This moment's `improve` targets — a unit whose AURA strengthened (Kennelmaster's Avenge bump, Mama Bear /
   *  Flowing Monk growth). The replay pops an in-place pulse at each, with NO badge hold/flash: an improve grows
   *  the unit's aura (future grants), not its own current Attack/Health. Wired only to the standalone `improve`
   *  moment kind — an improve absorbed into an attack rides that unit's self-buff pulse instead (no double-pop). */
  onImprove: (uids: string[]) => void;
  /** This moment's `maxGold` targets — a unit whose Avenge raised your max Gold (Soulsman, Bone Taxer). The replay
   *  bursts coins at each, on top of the "+N max gold" float. */
  onMaxGold: (uids: string[]) => void;
  /** This moment's NON-melee `dmg` targets — a unit hit by a Start-of-Combat nuke / split damage / Blaster's
   *  Deathrattle AoE. The replay pops a damage burst + impact ring at each, so a cast hit reads like a hit,
   *  not just a number. The melee pair is filtered out before this fires (see `meleePair`). */
  onDamageFx: (uids: string[]) => void;
  /** The attacker+defender of the attack this moment resolves, if any (`meleePairOfImpact`). Their hit FX
   *  already fired on the lunge's impact channel, so the `damageFx` cue drops them — without this the strike
   *  played twice (again on the defender, and once more on the attacker, which takes retaliation damage in
   *  the same collapsed moment). Null for non-melee damage, which bursts at every target. */
  meleePair: { attacker: string; defender: string } | null;
  /** This moment's summoned unit uids (the `minion.uid` of each `summon` event). The replay poofs dust at each
   *  arrival — a stone-into-dust land under the new unit. Fires late (see the cue offset) so the unit is grown. */
  onSummonFx: (uids: string[]) => void;
  /** This moment's `ascend` targets — a unit transforming into another (Tara→Taragosa, Spirit Pup→Worgen). The
   *  replay blooms a flash over each (masking the card swap) + pops the new card in (CSS). */
  onAscend: (uids: string[]) => void;
  /**
   * Flash a rallier's yellow trigger medallion — once per PROC, so a gilded Echohorn's double Rally reads as
   * two beats rather than one pulse followed by two effects (owner call 2026-08-05).
   *
   * The lunge still owns the FIRST pulse of the attacker's own Rally (it fires inside the GSAP timeline, at
   * the top of the wind-up, where it is seek- and speed-safe); this covers every proc after it. Optional
   * because the non-combat callers and older tests have no medallion to flash.
   */
  onRallyPulse?: (uid: string) => void;
}

/** The two units a moment is ABOUT, read off its PRIMARY event — what an authored def anchors to. `attack`
 *  names its pair differently (attacker/defender); every other event carries at most a `target` plus an
 *  optional `source`. A side the event doesn't carry is `null` (a `shieldUp` has a target but no source), which
 *  `anchorsForUnits` is specified to accept. */
function momentUnits(primary: CombatEvent): { source: string | null; target: string | null } {
  if (primary.type === 'attack') return { source: primary.attacker, target: primary.defender };
  const source = 'source' in primary && typeof primary.source === 'string' ? primary.source : null;
  const target = 'target' in primary && typeof primary.target === 'string' ? primary.target : null;
  return { source, target };
}

/**
 * Every rally in `moment` that has a def bound to it, with the units each proc summoned.
 *
 * THE ONE resolver for that question, because two callers ask it about the same moment and must not be able
 * to disagree: the layout effect in `useCombatReplay` WITHHOLDS these units pre-paint, and the `rallyFx` cue
 * RELEASES them as each sparkle lands. A set the holder computed and the releaser didn't would strand a live
 * minion off the board until its TTL — the one failure this whole path has to be immune to.
 *
 * `canPlayDefs()` is part of the answer rather than a caller's separate check, for exactly the same reason:
 * headless, or before `ensureDefsReady()` resolves, the cue schedules nothing, so nothing must be held.
 */
export function boundRalliesIn(moment: Moment, ctx: Pick<CueContext, 'events' | 'cardIds'>): BoundRally[] {
  if (!canPlayDefs()) return [];
  const out: BoundRally[] = [];
  for (const r of ralliesFiredIn(moment, ctx.events)) {
    const binding = bindingFor(ctx.cardIds?.get(r.source) ?? null, 'rally');
    if (binding) out.push({ ...r, binding });
  }
  return out;
}

/** A rally whose card has a def bound at the `rally` kind — `RallyFired` plus the resolved binding. */
export interface BoundRally extends RallyFired {
  binding: FxBinding;
}

/** Every unit a bound Rally is about to deliver in this moment, flattened — what the layout effect
 *  withholds. Flat because the holder doesn't care which proc owns which unit; only the releaser does. */
export function rallyDeliveredUids(moment: Moment, ctx: Pick<CueContext, 'events' | 'cardIds'>): string[] {
  return boundRalliesIn(moment, ctx).flatMap((r) => r.delivered.flat());
}

/** Run one moment's plain-effect cues (sfx + float + the three aura sub-channels). Each cue fires at
 *  `start + offset`: an offset ≤0 fires synchronously; a positive offset schedules a timer (÷combatSpeed
 *  unless `scaled:false`, e.g. the reborn re-form's fixed wall-clock). Returns a cleanup that cancels any
 *  pending timers. The `lunge`/`impact` pair is DOM-measuring/GSAP work handled separately by `engine.ts`'s
 *  `runAttackExchangeCues` — this registry silently ignores cue kinds it doesn't own, so `attackExchange`'s
 *  `lunge`/`impact` entries are no-ops here (by design). */
export function runMomentCues(moment: Moment, ctx: CueContext): () => void {
  // A damageFx claim (see `cardFx.ts`) is scoped to the step that made it — drop it the moment the replay
  // moves on, so it can never silence a burst in a later beat or a later fight.
  expireDamageFxClaim(moment.primary.step);
  const timers: ReturnType<typeof setTimeout>[] = [];
  const at = (cue: Cue, fn: () => void): void => {
    const off = Math.max(0, cue.offset ?? 0) / (cue.scaled === false ? 1 : (ctx.combatSpeed > 0 ? ctx.combatSpeed : 1));
    if (off <= 0) fn();
    else timers.push(setTimeout(fn, off));
  };
  const cues = getScore()[moment.kind];
  for (const cue of cues) {
    if (cue.enabled === false) continue;
    if (cue.ch === 'sfx') at(cue, () => { const { shake } = playMomentSfx(moment, ctx.events, ctx.cardIds); if (shake) ctx.onShake(); });
    else if (cue.ch === 'float') at(cue, () => {
      const { floats, deathFloats } = spawnFloats(moment, ctx.events, ctx.slotRectOf, ctx.attackerUid);
      if (floats.length) ctx.onFloats(floats);
      if (deathFloats.length) ctx.onDeathFloats(deathFloats);
    });
    // a real (non-Rise) death anywhere in the moment bursts its auras in place. `death` with `rise` is
    // intentionally NOT handled here — a Rise DEFENDER bursts in place (replay), a pulled-home Rise ATTACKER
    // bursts at the engine's `landed` (see the phase-3c integration task).
    else if (cue.ch === 'auraBurst') at(cue, () => {
      for (let i = moment.start; i < moment.end; i++) { const e = ctx.events[i]; if (e?.type === 'death' && !e.rise) ctx.onAuraBurst(e.target); }
    });
    else if (cue.ch === 'auraBreak') at(cue, () => {  // DS consumed: delayed gold shatter
      for (let i = moment.start; i < moment.end; i++) { const e = ctx.events[i]; if (e?.type === 'shield') ctx.onShieldBreak(e.target); }
    });
    // Execute proc: the crescent strike at each victim. SKIPPED on `attackExchange` — there the impact channel
    // fires it at the lunge's real contact point (and replaces the standard hit FX), so running it here too
    // would double-slash, once at the victim's slot and once at contact. This path covers the non-melee procs
    // (a Start-of-Combat nuke or split damage from an Execute minion), which have no lunge to anchor to.
    else if (cue.ch === 'executeFx') at(cue, () => {
      if (moment.kind === 'attackExchange') return;
      const uids: string[] = [];
      // Claimed units are covered by an authored effect (see `claimDamageFx`) — the strike is part of the
      // stock hit presentation this replaces, so it is skipped for the same units the burst is.
      for (let i = moment.start; i < moment.end; i++) {
        const e = ctx.events[i];
        if (e?.type === 'poison' && !isDamageFxClaimed(e.step, e.target)) uids.push(e.target);
      }
      if (uids.length) ctx.onExecuteFx(uids);
    });
    else if (cue.ch === 'auraReform') at(cue, () => {  // reborn: re-form glow
      for (let i = moment.start; i < moment.end; i++) { const e = ctx.events[i]; if (e?.type === 'reborn') ctx.onReborn(e.target); }
    });
    else if (cue.ch === 'buffCast') at(cue, () => {
      const casts = groupBuffCasts(moment, ctx.events);
      if (casts.length) ctx.onBuffCasts(casts);
    });
    else if (cue.ch === 'buffSelf') at(cue, () => {
      const selfBuffs = groupSelfBuffs(moment, ctx.events);
      if (selfBuffs.length) ctx.onSelfBuffs(selfBuffs);
    });
    else if (cue.ch === 'improveSelf') at(cue, () => {
      const uids: string[] = [];
      for (let i = moment.start; i < moment.end; i++) { const e = ctx.events[i]; if (e?.type === 'improve') uids.push(e.target); }
      if (uids.length) ctx.onImprove(uids);
    });
    else if (cue.ch === 'coins') at(cue, () => {
      const uids: string[] = [];
      for (let i = moment.start; i < moment.end; i++) { const e = ctx.events[i]; if (e?.type === 'maxGold') uids.push(e.target); }
      if (uids.length) ctx.onMaxGold(uids);
    });
    else if (cue.ch === 'damageFx') at(cue, () => {
      const uids = new Set<string>();
      for (let i = moment.start; i < moment.end; i++) {
        const e = ctx.events[i];
        // Skip a unit an authored per-card effect already claimed for this step (see `claimDamageFx`): its
        // impact is that effect's job, and firing the generic burst too reads as the old effect never having
        // been replaced.
        if (e?.type === 'dmg' && !isDamageFxClaimed(e.step, e.target)) uids.add(e.target);
      }
      // A melee clash is TWO-WAY: the defender's hit and the attacker's retaliation are both `dmg` events in
      // this one collapsed moment. Both units' hit FX were already fired by the lunge's impact channel (once,
      // at contact, on the defender), so bursting them again here doubled the strike on the defender AND put
      // a second one on the attacker — the "two strike animations" (owner report 2026-07-21). Skip exactly
      // that pair. Splash targets (Cleave neighbours, AoE) are NOT covered by the impact channel and keep
      // their burst, which is the whole point of this cue.
      if (ctx.meleePair) { uids.delete(ctx.meleePair.attacker); uids.delete(ctx.meleePair.defender); }
      if (uids.size) ctx.onDamageFx([...uids]);
    });
    // A RUBY landed on one or more units in this moment (set 2 Kobolds) — one detonation each, walked down the
    // board rather than fired together. Guarded before `at()` exactly like `fxDef`: with no defs ready this
    // costs two property reads and allocates nothing.
    else if (cue.ch === 'rubyFx') {
      if (!canPlayDefs()) continue;
      at(cue, () => {
        // A CASCADE of N-STACKS: `gap` walks between recipients, `beat` repeats within one. Nested, not
        // flattened — two Rubies on a minion play as two hits on THAT minion before the sweep moves on, which
        // is what says "each unit got two" rather than "everyone got hit twice". Offsets divide by
        // `combatSpeed` inside `scheduleLands`, so a 4× replay sweeps 4× faster and still lands inside its beat.
        // The traversal arithmetic lives in `scheduleLands`, not here — see `fx/land.ts`. This site only says
        // WHAT a land does; the schedule says WHEN.
        const rubyLands = rubiedLandsIn(moment, ctx.events);
        // WITHHOLD the stat change so the effect can deliver it. Done here, at cue time, because the cue is
        // the only place that knows the number; a `react` layer with "carries the number" releases it at its
        // peak (see `fx/statHold.ts`). If the bound def has no such layer the hold expires on its own and the
        // badge simply tells the truth — opting in is authoring, not plumbing.
        //
        // Known simplification: a STACK (two Rubies on one body) is held as one total and delivered whole by
        // the first gem's release, so the badge steps once rather than twice. Correct, just less expressive
        // than the gems themselves; splitting it needs a partial release, which needs the def to know the
        // per-gem amount.
        //
        // CLAIM AN EXISTING HOLD; NEVER STACK ON ONE (owner report 2026-08-31: *"the stats dance around a
        // lot in combat, setting to randomly low values / the badges go red, then they correct"*).
        //
        // The replay places ONE hold per unit for the whole beat's delta — Rubies included — at `effect`
        // rank, and this cue is `effect` rank too. `holdStat` ACCUMULATES equal ranks, by design: two of them
        // usually are two changes. Here they are the same change, so the Ruby was withheld TWICE and the
        // badge printed `current - 2x` — a number the unit never had, below its own floor, which is what
        // paints the plate red until the rolls catch up.
        //
        // The replay's delta is the authoritative one (it nets same-beat damage into Health, which a
        // per-Ruby land cannot see), so the right move is to take that hold over rather than add to it:
        // `claimStat` changes the OWNER and leaves the delta, the schedule and the expiry alone. Placing is
        // still correct when nothing is live — a Ruby moment with no replay hold behind it.
        for (const l of rubyLands) claimOrHold(l.uid, { attack: l.attack, health: l.health });
        for (const land of scheduleLands(cascade(rubyLands), {
          gap: RUBY_GAP_MS, beat: RUBY_BEAT_MS, speed: ctx.combatSpeed,
        })) {
          // Both ends are the same unit: a Ruby lands ON a minion, there is no pair to travel between.
          // Anchors resolve INSIDE the timer rather than up front, so a unit that dies mid-sweep is skipped
          // instead of detonating over an empty slot.
          const fire = (): void => {
            const rubyAnchors = anchorsForUnits(land.uid, land.uid);
            if (rubyAnchors) playDef('ruby-gem-apply', rubyAnchors, { uids: { source: land.uid, target: land.uid }, index: land.group }); // literal, not the constant — see RUBY_LANDED_DEF
            // One play per GEM, not per moment — the ear carries the same count the eye does.
            sfx.gemApply();
          };
          if (land.at <= 0) fire();
          else timers.push(setTimeout(fire, land.at));
        }
      });
    }
    // A RALLY fired inside this moment — the rallier's own authored flourish at the ally it procced. Unlike
    // `fxDef` (one binding per moment, off the primary event) this resolves a binding PER RALLY EVENT, because
    // a Rally is absorbed into its attacker's wind-up and so never owns the moment it lives in. See
    // `channels/rallyFired.ts` for the whole argument. Guarded before `at()` exactly like `fxDef`/`rubyFx`.
    else if (cue.ch === 'rallyFx') {
      if (!canPlayDefs()) continue;
      // Bindings resolve UP FRONT (in `boundRalliesIn`), and unbound ralliers are dropped there rather than
      // inside the timer, so the cascade's `gap` walks only the pairs that actually play — an unbound rallier
      // must not leave a hole in the rhythm. `fanOut` is deliberately ignored on this row: a Rally's fan-out IS
      // its pair, and the two ends come from the event rather than from a scan the binding chooses.
      const fired = boundRalliesIn(moment, ctx);
      if (!fired.length) continue;
      // DEV-only, and modelled on the `fxDef` fan-out's log for the same reason it exists there: every miss in
      // this path is SILENT — the effect simply doesn't appear, which is indistinguishable from "the binding
      // isn't wired". This row is the one that says a Rally was seen, whose it was, and HOW MANY procs it
      // carried, which is the number the cascade's `beat` exists to make visible.
      if (import.meta.env.DEV) {
        for (const r of fired) {
          const held = r.delivered.flat();
          console.info(`[fx] rally ${r.source}→${r.target} → '${r.binding.def}' ×${r.count}${held.length ? ` (delivering ${held.join(', ')})` : ''}`);
        }
      }
      at(cue, () => {
        // The same CASCADE-of-N-STACKS shape the Ruby sweep uses: `gap` walks between distinct rallier→ally
        // pairs, `beat` repeats within one. `land.group` indexes `fired` because `cascade` emits exactly one
        // group per entry, in order; `land.member` is the proc index within that pair.
        //
        // The `beat` is a whole PROC STRIDE rather than a bare gap: it spaces each proc's SPARKLE so a gilded
        // double reads as two lands rather than one thick detonation. The medallion now pulses ONCE per Rally
        // at the opener (owner call 2026-08-24, reversing the 2026-08-05 once-per-proc call) — the doubling
        // reads through the repeated effect, not a repeated pulse — but the stride still sequences the effects.
        //
        // `lead` is the sequencing from 2026-08-04: the attacker's pulse fires at the top of the wind-up and
        // the sparkle follows it rather than landing on top of it. Only on `attackExchange` — the only kind
        // with a wind-up to wait for; a standalone rally moment would otherwise sit doing nothing for half a
        // second. Read live (not frozen into the score table) so a retuned wind-up carries both with it.
        const inExchange = moment.kind === 'attackExchange';
        const speed = ctx.combatSpeed > 0 ? ctx.combatSpeed : 1;
        // The lunge already pulses the ATTACKER once, at the top of its wind-up, from inside the GSAP timeline —
        // so this cue never pulses the attacker at all (its opener is the lunge's; its extra procs don't pulse).
        // A NON-lunge rallier still gets its own single opener pulse (member 0). Keyed on the attacker uid.
        const lungePulsed = inExchange && moment.primary.type === 'attack' ? moment.primary.attacker : null;
        for (const land of scheduleLands(cascade(fired.map((r) => ({ uid: r.target, count: r.count }))), {
          gap: RALLY_GAP_MS, beat: RALLY_PROC_STRIDE_MS, speed,
          lead: inExchange ? rallyLeadMs(getLungeConfig().windupDur) : 0,
        })) {
          const r = fired[land.group];
          if (!r) continue;
          // ONE pulse per Rally: only the OPENER (member 0) pulses the rallier's medallion. Extra procs still
          // fire their own SPARKLE (below) but no extra pulse, so a gilded double reads as one pulse then
          // sparkle → sparkle (owner call 2026-08-24, reversing the 2026-08-05 once-per-proc call — the
          // doubling reads through the repeated sparkle + effect, not a repeated pulse). The attacker's opener
          // is the lunge's own wind-up pulse, so this cue owns the opener only for a NON-lunge rallier.
          if (ctx.onRallyPulse && land.member === 0 && r.source !== lungePulsed) {
            const src = r.source;
            const pulseAt = Math.max(0, land.at - RALLY_PULSE_READ_MS / speed);
            const pulse = (): void => ctx.onRallyPulse?.(src);
            if (pulseAt <= 0) pulse();
            else timers.push(setTimeout(pulse, pulseAt));
          }
          // THIS proc's litter — `land.member` is its index within the pair's stack, which is the same order
          // `delivered` is built in. So a gilded Echohorn's first sparkle reveals the first pair of cubs and
          // its second reveals the second, instead of both arriving on the first.
          const litter = r.delivered[land.member] ?? [];
          // Anchors resolve INSIDE the timer, like the Ruby sweep: either end can die mid-cascade (the ally's
          // own Echo can kill it), and a dead unit should be skipped rather than played over an empty slot.
          const fire = (): void => {
            const rallyAnchors = anchorsForUnits(r.source, r.target);
            if (rallyAnchors) playDef(r.binding.def, rallyAnchors, { uids: { source: r.source, target: r.target }, index: land.group });
            // Released whether or not the def could anchor. The hold is a PRESENTATION debt: if the effect
            // can't play there is nothing left to deliver the unit, and leaving it withheld to time out would
            // hide a live minion for the sake of an effect that never happened.
            releaseSummons(litter);
          };
          if (land.at <= 0) fire();
          else timers.push(setTimeout(fire, land.at));
        }
      });
    }
    else if (cue.ch === 'summonFx') at(cue, () => {
      const uids: string[] = [];
      for (let i = moment.start; i < moment.end; i++) { const e = ctx.events[i]; if (e?.type === 'summon') uids.push(e.minion.uid); }
      if (uids.length) ctx.onSummonFx(uids);
    });
    else if (cue.ch === 'ascendFx') at(cue, () => {
      const uids: string[] = [];
      for (let i = moment.start; i < moment.end; i++) { const e = ctx.events[i]; if (e?.type === 'ascend') uids.push(e.target); }
      if (uids.length) ctx.onAscend(uids);
    });
    // An AUTHORED FX def (fx/playDef) plays at this moment — in production too, since the un-gate. Guarded
    // BEFORE `at()` so the NOT-READY path costs nothing: headless, and during the window before
    // `ensureDefsReady()` resolves, `canPlayDefs()` is false (two property reads, short-circuiting on the
    // first) and this allocates no closure and schedules no timer.
    else if (cue.ch === 'fxDef') {
      if (!canPlayDefs()) continue;
      // The ONE-CHANNEL RULE (the same one the Ruby cue applies to the generic buff channels): a Rally is told
      // by `rallyFx`, which scans every rally event in the moment and plays one per PROC at that proc's own
      // pair. This row would play the `rally` binding a second time — once, at the primary event's pair — for
      // any moment that happened to be classified `rally`. Standing down is what keeps the count honest.
      if (moment.kind === 'rally') continue;
      // The card comes from `ctx.cardIds` — the replay's own uid→card map, already threaded in for the sfx
      // channel's death voicelines. It replaces a DOM lookup (`[data-card]`), which was the most suspect link
      // in this chain: it depended on the unit being rendered, findable by selector, and carrying an attribute
      // added for this feature. Combat state knows the answer without any of that.
      const primaryUnits = momentUnits(moment.primary);
      const target = primaryUnits.target;
      let source = primaryUnits.source;
      // A damage MOMENT's primary can be sourceless — a Divine Shield pop (`shield`) leads the wave when the
      // first target has a Ward, so `momentUnits` reads no source though the wave HAS an actor. Fall back to the
      // first `dmg` event's own `source` (every hit in one wave shares it), so a source→target binding — Fel
      // Spikes' Echo volley — still attributes to the caster. `dmg.source` is undefined for legacy/sourceless
      // damage, in which case this stays null and nothing changes.
      if (source === null) {
        for (let i = moment.start; i < moment.end; i++) {
          const e = ctx.events[i];
          if (e?.type === 'dmg' && typeof e.source === 'string') { source = e.source; break; }
        }
      }
      const cardId = ctx.cardIds?.get(source ?? '') ?? null;
      // ale-bubbles (Set 2, Dwarves): a Dwarf that GENERATES a Dwarven Ale in combat — Doubletap Brewer's Echo,
      // Blade Thrower's Rally — emits a `toHand` event whose cardId is an Ale, carrying the generator's uid as
      // `source`. Burst from that unit. Keyed on the GRANTED card being an Ale (not on the generator's id), so
      // any future combat ale-generator is covered for free. Additive to and independent of the generic
      // `to-hand` binding below; one fxDef cue per toHand moment, so the scan can't double-fire.
      if (moment.kind === 'toHand') {
        const aleSources = new Set<string>();
        for (let i = moment.start; i < moment.end; i++) {
          const e = ctx.events[i];
          if (e?.type === 'toHand' && e.side === 'player' && typeof e.source === 'string' && ALE_IDS.includes(e.cardId)) {
            aleSources.add(e.source);
          }
        }
        if (aleSources.size > 0) {
          at(cue, () => {
            for (const src of aleSources) {
              const aleAnchors = anchorsForUnits(src, src);
              if (aleAnchors) playDef('ale-bubbles', aleAnchors, { uids: { source: src, target: src } });
            }
          });
        }
      }
      // Resolved ONCE, here, rather than separately for the claim and again inside the deferred callback —
      // two lookups of the same key are two chances to disagree.
      const binding = bindingFor(cardId, moment.kind);
      if (!binding) continue;                    // nothing bound at this kind/card → nothing to schedule
      if (binding.fanOut === 'damaged' || binding.fanOut === 'struck') {
        // Claim the stock hit-burst for the units this binding will cover, SYNCHRONOUSLY — before `at()`
        // defers anything. Moments are scheduled in log order and the `damage` moment follows its own cast,
        // so the claim is standing by the time that moment's `damageFx` cue is scheduled. Doing it inside the
        // deferred callback would race: the burst is scheduled first and would fire regardless.
        // Scanned ONCE and then reused by the deferred play, for the same reason the binding is resolved once:
        // the claim suppresses the stock burst for exactly this set, so a second scan that disagreed would
        // silence one set of units while the def played at another — silently, and only in the divergent case.
        // `struck` also covers a WARD-blocked victim (Fel Spikes' spike flies at it and the Ward shatters);
        // those carry a `shield` event, not a `dmg`, so they never had a stock burst to suppress — claiming
        // them is a harmless no-op that keeps one code path for both fan-outs.
        const hitUids = binding.fanOut === 'struck'
          ? struckUidsIn(ctx.events, moment.start, moment.end)
          : damagedUidsIn(ctx.events, moment.start, moment.end);
        // Drop the MELEE PAIR (attacker + defender). A melee attack's impact is ALSO a `damage` moment, so a
        // source→target binding on `damage` — Fel Spikes' Echo volley — would otherwise fire every time the
        // unit SWINGS, not only on its Echo spray (owner report 2026-08-20). The stock `damageFx` cue drops the
        // same pair for the same reason (the lunge's impact channel owns their hit FX). The Echo wave is not an
        // attack, so its `meleePair` is null and every victim survives the filter.
        const claimed = ctx.meleePair
          ? hitUids.filter((u) => u !== ctx.meleePair!.attacker && u !== ctx.meleePair!.defender)
          : hitUids;
        claimDamageFx(moment.primary.step, claimed);
        // DEV-only, and deliberately loud about the FAILURE case. Every miss in this path so far has been
        // silent — the effect simply doesn't appear and the stock burst does, which is indistinguishable
        // from "the binding isn't wired". A binding that matched but found no targets is the specific bug
        // that already happened once (searching the wrong moment), so it gets a warning, not a log line — but
        // NOT when the melee-pair filter emptied a non-empty hit set (that is the expected "own swing" case).
        if (import.meta.env.DEV) {
          if (hitUids.length === 0) {
            console.warn(
              `[fx] '${cardId ?? moment.kind}' → '${binding.def}' matched at '${moment.kind}' but found NO ` +
                `target units in step ${String(moment.primary.step)} — nothing will play.`,
            );
          } else if (claimed.length > 0) {
            console.info(`[fx] '${cardId ?? moment.kind}' → '${binding.def}' ×${claimed.length}`, claimed);
          }
        }
        // `launchOnDeath` (Fel Spikes' Echo): the claim above still suppresses the stock burst on this damage
        // beat, but the projectile itself is NOT played here — it launched a beat earlier from the dying body
        // (see `useCombatReplay`'s death handling), and this beat is held back so the damage lands when it
        // connects. So only SCHEDULE the play for the ordinary same-beat case.
        if (!binding.launchOnDeath) {
          at(cue, () => {
            // The cast's own event carries no target (Bloodbinder emits one `sc` then a damage event per
            // marked enemy), so travel to each unit it actually damaged instead of collapsing onto the source.
            claimed.forEach((uid, i) => {
              const fanAnchors = anchorsForUnits(source, uid);
              if (fanAnchors) playDef(binding.def, fanAnchors, { uids: { source, target: uid }, index: i });
            });
          });
        }
      } else if (binding.fanOut === 'selfBuffed') {
        at(cue, () => {
          // Both ends are the same unit: a self-buff has no pair to travel between, so `source` and `target`
          // resolve to the same card and a travelling layer simply stays put on it.
          for (const sb of groupSelfBuffs(moment, ctx.events)) {
            const selfAnchors = anchorsForUnits(sb.uid, sb.uid);
            if (selfAnchors) playDef(binding.def, selfAnchors, { uids: { source: sb.uid, target: sb.uid } });
          }
        });
      } else if (binding.fanOut === 'buffed') {
        at(cue, () => {
          // Once per unit the source EMPOWERED (source !== target) — Karwind pumping every Dragon. Rides the
          // exact same `groupBuffCasts` the tendril channel uses, so the def lands on precisely the units that
          // grew, at their own anchor (`target`). Additive: the buff tendril still fires; this plays on top.
          // `index` drives per-recipient `stagger`, matching the `damaged` fan-out.
          groupBuffCasts(moment, ctx.events).forEach((c, i) => {
            const fanAnchors = anchorsForUnits(c.source, c.target);
            if (fanAnchors) playDef(binding.def, fanAnchors, { uids: { source: c.source, target: c.target }, index: i });
          });
        });
      } else {
        // `primary` (the default, and what an absent `fanOut` means): once, at the moment's own pair.
        at(cue, () => {
          const anchors = anchorsForUnits(source, target);
          if (!anchors) return;                  // the unit already left the screen → skip silently
          // Unknown def id → `playDef` returns null, so a build without this def's JSON is a silent no-op. The
          // returned stop() is deliberately NOT wired into this runner's cleanup: every channel here is
          // fire-and-forget (an aura burst outlives its moment too), and cancelling on moment-change would cut
          // the effect off mid-play.
          playDef(binding.def, anchors, { uids: { source, target } });
        });
      }
    }
    // lunge/impact are engine-driven (runAttackExchangeCues) — no-op here, by design.
  }
  return () => timers.forEach((id) => clearTimeout(id));
}
