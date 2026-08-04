import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import type { MomentKind } from './kinds';
import { playMomentSfx } from './channels/sfx';
import { spawnFloats, type Float, type DeathFloat } from './channels/float';
import { groupBuffCasts } from './channels/buffCast';
import { groupSelfBuffs } from './channels/buffSelf';
import { rubiedLandsIn, RUBY_BEAT_MS, RUBY_GAP_MS } from './channels/rubyLanded';
import { cascade, scheduleLands } from '../fx/land';
import { holdStat } from '../fx/statHold';
import { canPlayDefs, playDef } from '../fx/playDef';
import { sfx } from '../sfx';
import { anchorsForUnits } from '../fx/combatAnchors';
import { claimDamageFx, damagedUidsIn, expireDamageFxClaim, isDamageFxClaimed } from './cardFx';
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
export type Channel = 'sfx' | 'float' | 'lunge' | 'impact' | 'auraBurst' | 'auraBreak' | 'auraReform' | 'buffCast' | 'buffSelf' | 'improveSelf' | 'coins' | 'damageFx' | 'summonFx' | 'ascendFx' | 'executeFx' | 'fxDef' | 'rubyFx';
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
        for (const l of rubyLands) holdStat(l.uid, { attack: l.attack, health: l.health });
        for (const land of scheduleLands(cascade(rubyLands), {
          gap: RUBY_GAP_MS, beat: RUBY_BEAT_MS, speed: ctx.combatSpeed,
        })) {
          // Both ends are the same unit: a Ruby lands ON a minion, there is no pair to travel between.
          // Anchors resolve INSIDE the timer rather than up front, so a unit that dies mid-sweep is skipped
          // instead of detonating over an empty slot.
          const fire = (): void => {
            const rubyAnchors = anchorsForUnits(land.uid, land.uid);
            if (rubyAnchors) playDef('ruby-gem-apply', rubyAnchors, { uids: { source: land.uid, target: land.uid } }); // literal, not the constant — see RUBY_LANDED_DEF
            // One play per GEM, not per moment — the ear carries the same count the eye does.
            sfx.gemApply();
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
      // The card comes from `ctx.cardIds` — the replay's own uid→card map, already threaded in for the sfx
      // channel's death voicelines. It replaces a DOM lookup (`[data-card]`), which was the most suspect link
      // in this chain: it depended on the unit being rendered, findable by selector, and carrying an attribute
      // added for this feature. Combat state knows the answer without any of that.
      const { source, target } = momentUnits(moment.primary);
      const cardId = ctx.cardIds?.get(source ?? '') ?? null;
      // Resolved ONCE, here, rather than separately for the claim and again inside the deferred callback —
      // two lookups of the same key are two chances to disagree.
      const binding = bindingFor(cardId, moment.kind);
      if (!binding) continue;                    // nothing bound at this kind/card → nothing to schedule
      if (binding.fanOut === 'damaged') {
        // Claim the stock hit-burst for the units this binding will cover, SYNCHRONOUSLY — before `at()`
        // defers anything. Moments are scheduled in log order and the `damage` moment follows its own cast,
        // so the claim is standing by the time that moment's `damageFx` cue is scheduled. Doing it inside the
        // deferred callback would race: the burst is scheduled first and would fire regardless.
        // Scanned ONCE and then reused by the deferred play, for the same reason the binding is resolved once:
        // the claim suppresses the stock burst for exactly this set, so a second scan that disagreed would
        // silence one set of units while the def played at another — silently, and only in the divergent case.
        const claimed = damagedUidsIn(ctx.events, moment.start, moment.end);
        claimDamageFx(moment.primary.step, claimed);
        // DEV-only, and deliberately loud about the FAILURE case. Every miss in this path so far has been
        // silent — the effect simply doesn't appear and the stock burst does, which is indistinguishable
        // from "the binding isn't wired". A binding that matched but found no targets is the specific bug
        // that already happened once (searching the wrong moment), so it gets a warning, not a log line.
        if (import.meta.env.DEV) {
          if (claimed.length === 0) {
            console.warn(
              `[fx] '${cardId ?? moment.kind}' → '${binding.def}' matched at '${moment.kind}' but found NO ` +
                `damaged units in step ${String(moment.primary.step)} — nothing will play.`,
            );
          } else {
            console.info(`[fx] '${cardId ?? moment.kind}' → '${binding.def}' ×${claimed.length}`, claimed);
          }
        }
        at(cue, () => {
          // The cast's own event carries no target (Bloodbinder emits one `sc` then a damage event per
          // marked enemy), so travel to each unit it actually damaged instead of collapsing onto the source.
          for (const uid of claimed) {
            const fanAnchors = anchorsForUnits(source, uid);
            if (fanAnchors) playDef(binding.def, fanAnchors, { uids: { source, target: uid } });
          }
        });
      } else if (binding.fanOut === 'selfBuffed') {
        at(cue, () => {
          // Both ends are the same unit: a self-buff has no pair to travel between, so `source` and `target`
          // resolve to the same card and a travelling layer simply stays put on it.
          for (const sb of groupSelfBuffs(moment, ctx.events)) {
            const selfAnchors = anchorsForUnits(sb.uid, sb.uid);
            if (selfAnchors) playDef(binding.def, selfAnchors, { uids: { source: sb.uid, target: sb.uid } });
          }
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
