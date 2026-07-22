import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import type { MomentKind } from './kinds';
import { playMomentSfx } from './channels/sfx';
import { spawnFloats, type Float, type DeathFloat } from './channels/float';
import { groupBuffCasts } from './channels/buffCast';
import { groupSelfBuffs } from './channels/buffSelf';

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
export type Channel = 'sfx' | 'float' | 'lunge' | 'impact' | 'auraBurst' | 'auraBreak' | 'auraReform' | 'buffCast' | 'buffSelf' | 'improveSelf' | 'coins' | 'damageFx' | 'summonFx' | 'ascendFx';
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
 *  and `impact` (the smack/FX/recoil) at the `contact` anchor the lunge defines, plus auraBurst (a death grouped
 *  into an attack's absorbed-windup run must still burst in place). A Ward CONSUMED by the exchange has no
 *  `auraBreak` cue here — the engine shatters it at the lunge's real `contact` (see `onImpactAuras`). The aura sub-channels
 *  are on EVERY kind because `death`/`shield` are RESULT_TYPES that collapse into another kind's moment (e.g.
 *  `[dmg, death]` is a `damage`-kind moment CONTAINING a death) — gating them on death/shieldPop kinds would
 *  miss those grouped effects. `auraReform` (the reborn re-form glow) rides only on the `reborn` kind, since a
 *  reborn is never grouped into another kind's moment. The three aura sub-channels (`auraBurst` = a real death
 *  bursting its auras in place at offset 0; `auraBreak` = a Divine-Shield consume's delayed gold shatter at
 *  +300ms scaled; `auraReform` = a reborn re-form glow at +460ms fixed wall-clock) each carry their own offset
 *  so a later authoring pass can retime each independently. Each kind gets its OWN array (not a shared
 *  reference) so a future authoring pass can vary one kind's cues without mutating others. */
export const SCORE_DEFAULTS: Record<MomentKind, Cue[]> = {
  attackExchange: [
    { ch: 'sfx', at: 'start' }, { ch: 'float', at: 'start' },
    { ch: 'lunge', at: 'start' }, { ch: 'impact', at: 'contact', offset: 0 },
    // NB: no `auraBreak` here — a Ward consumed by THIS exchange shatters at the lunge's real `contact` position
    // (engine-driven, `onImpactAuras`), not on a fixed start-relative delay that drifted off the hit and left the
    // bubble lingering disjointed from the unit. `auraBurst` (a death's in-place burst) stays at start.
    { ch: 'auraBurst', at: 'start', offset: 0 },
  ],
  // `damageFx` = a NON-melee hit burst (damageBurst + impact ring) at each dmg target. On `damage` (SC nukes,
  // split damage) and `death` (Blaster's Deathrattle AoE lands in its death moment). Melee dmg stays in
  // `attackExchange` (already has the full lunge/impact FX), so it never double-bursts; the handler no-ops on a
  // plain death that carries no dmg events.
  damage: [...BASE, { ch: 'damageFx', at: 'start', offset: 0 }], shieldPop: [...BASE], poisonTick: [...BASE],
  death: [...BASE, { ch: 'damageFx', at: 'start', offset: 0 }], riseDeath: [...BASE], scCast: [...BASE],
  // `summonFx` = a dust poof at the arriving unit, at +250ms (scaled) to land on the `summonpop` overshoot (the
  // "bounce") — by then the scale-in has grown the unit to a measurable, full size.
  summon: [...BASE, { ch: 'summonFx', at: 'start', offset: 250 }], buffWave: [...BASE, { ch: 'buffCast', at: 'start', offset: 0 }, { ch: 'buffSelf', at: 'start', offset: 0 }], reborn: withReform(),
  ascend: [...BASE, { ch: 'ascendFx', at: 'start', offset: 0 }],
  rally: [...BASE], toHand: [...BASE],
  maxGold: [...BASE, { ch: 'coins', at: 'start', offset: 0 }],
  improve: [...BASE, { ch: 'improveSelf', at: 'start', offset: 0 }],
  keyword: [...BASE], keywordLost: [...BASE], hpGrant: [...BASE], spellProgress: [...BASE], reveal: [...BASE],
  tribeAura: [...BASE], // the wash itself is fired from the per-beat scan in useCombatReplay (like spell power), not a choreo channel
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
  /** Whether this moment's melee exchange was a Cleave (`isCleaveImpact`). When it splashed, the victims go
   *  to `onCleaveFx` as one volley instead of each taking the generic burst. */
  cleaveHit: boolean;
  /** The struck group of a splashing Cleave — the defender plus every splashed neighbour. The replay rakes a
   *  single claw-slash volley across their combined footprint. */
  onCleaveFx: (uids: string[]) => void;
  /** This moment's summoned unit uids (the `minion.uid` of each `summon` event). The replay poofs dust at each
   *  arrival — a stone-into-dust land under the new unit. Fires late (see the cue offset) so the unit is grown. */
  onSummonFx: (uids: string[]) => void;
  /** This moment's `ascend` targets — a unit transforming into another (Tara→Taragosa, Spirit Pup→Worgen). The
   *  replay blooms a flash over each (masking the card swap) + pops the new card in (CSS). */
  onAscend: (uids: string[]) => void;
}

/** Run one moment's plain-effect cues (sfx + float + the three aura sub-channels). Each cue fires at
 *  `start + offset`: an offset ≤0 fires synchronously; a positive offset schedules a timer (÷combatSpeed
 *  unless `scaled:false`, e.g. the reborn re-form's fixed wall-clock). Returns a cleanup that cancels any
 *  pending timers. The `lunge`/`impact` pair is DOM-measuring/GSAP work handled separately by `engine.ts`'s
 *  `runAttackExchangeCues` — this registry silently ignores cue kinds it doesn't own, so `attackExchange`'s
 *  `lunge`/`impact` entries are no-ops here (by design). */
export function runMomentCues(moment: Moment, ctx: CueContext): () => void {
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
      const { floats, deathFloats } = spawnFloats(moment, ctx.events, ctx.findEl, ctx.attackerUid);
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
      for (let i = moment.start; i < moment.end; i++) { const e = ctx.events[i]; if (e?.type === 'dmg') uids.add(e.target); }
      // A melee clash is TWO-WAY: the defender's hit and the attacker's retaliation are both `dmg` events in
      // this one collapsed moment. Both units' hit FX were already fired by the lunge's impact channel (once,
      // at contact, on the defender), so bursting them again here doubled the strike on the defender AND put
      // a second one on the attacker — the "two strike animations" (owner report 2026-07-21). Skip exactly
      // that pair. Splash targets (Cleave neighbours, AoE) are NOT covered by the impact channel and keep
      // their burst, which is the whole point of this cue.
      if (ctx.meleePair) { uids.delete(ctx.meleePair.attacker); uids.delete(ctx.meleePair.defender); }
      if (!uids.size) return;
      // A CLEAVE that actually splashed swaps the per-victim bursts for ONE claw-slash volley raked across the
      // whole struck group — the main defender included, so the rake spans what it hit (owner call 2026-07-21).
      // Same "a keyword replaces the standard VFX" rule as Flurry's wind-slash.
      if (ctx.cleaveHit && ctx.meleePair) { ctx.onCleaveFx([ctx.meleePair.defender, ...uids]); return; }
      ctx.onDamageFx([...uids]);
    });
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
    // lunge/impact are engine-driven (runAttackExchangeCues) — no-op here, by design.
  }
  return () => timers.forEach((id) => clearTimeout(id));
}
