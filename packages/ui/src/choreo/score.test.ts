import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '@game/core';
import { compileMoments, type Moment } from './compile';
import { rallyLeadMs, RALLY_GAP_MS, RALLY_PROC_STRIDE_MS, RALLY_PULSE_READ_MS } from './channels/rallyFired';
import { getLungeConfig } from '../lungeConfig';
import { sfx } from '../sfx';
import { SCORE_DEFAULTS, getScore, getCues, setCue, resetScore, scoreJson, runMomentCues, rallyDeliveredUids, type Channel } from './score';
import { anySummonHeld, holdSummon, isSummonHeld, releaseAllSummons } from '../fx/summonHold';
import { momentKind, type MomentKind } from './kinds';
import { holdMsForKind } from './choreoConfig';
import { canPlayDefs, playDef } from '../fx/playDef';
import { anchorsForUnits } from '../fx/combatAnchors';
import { bindingFor } from './bindings';

// The `fxDef` channel's collaborators are mocked at the CONTRACT (`playDef`/`canPlayDefs`/`anchorsForUnits`),
// so these tests prove the SCORE's dispatch/guard/timing wiring without depending on how the fx layer renders.
vi.mock('../fx/playDef', () => ({ playDef: vi.fn(() => () => {}), canPlayDefs: vi.fn(() => true) }));
vi.mock('../fx/combatAnchors', () => ({ anchorsForUnits: vi.fn(() => ({ target: { x: 5, y: 7 } })) }));
const mockPlayDef = vi.mocked(playDef);
const mockCanPlayDefs = vi.mocked(canPlayDefs);
const mockAnchors = vi.mocked(anchorsForUnits);
/** The per-card path now reads the replay's own uid→card map out of ctx, so a case opts in by passing one
 *  rather than by mocking a DOM lookup. No map = no per-card binding = the kind-level default. */
const withCard = (uid: string, cardId: string) => ({ cardIds: new Map([[uid, cardId]]) });

const moment = (kind: Moment['kind'], events: CombatEvent[]): Moment => ({ start: 0, end: events.length, primary: events[0]!, stepGroups: [[0]], kind });
const baseCtx = (events: CombatEvent[], overrides: Partial<Parameters<typeof runMomentCues>[1]> = {}) => ({
  events, combatSpeed: 1, onShake: vi.fn(), slotRectOf: () => ({ cx: 0, cy: 0, w: 100, h: 140 }), attackerUid: null, meleePair: null,
  onFloats: vi.fn(), onDeathFloats: vi.fn(),
  onAuraBurst: vi.fn(), onShieldBreak: vi.fn(), onReborn: vi.fn(), onBuffCasts: vi.fn(), onSelfBuffs: vi.fn(), onImprove: vi.fn(), onMaxGold: vi.fn(), onDamageFx: vi.fn(), onSummonFx: vi.fn(), onAscend: vi.fn(), onExecuteFx: vi.fn(), ...overrides,
});
const ctx = baseCtx;

afterEach(() => vi.restoreAllMocks());

describe('score', () => {
  it('every MomentKind has a cue list (exhaustive score)', () => {
    for (const cues of Object.values(SCORE_DEFAULTS)) expect(Array.isArray(cues)).toBe(true);
  });

  it('attackExchange scores lunge (start) + impact (contact) — no sfx/float double-firing the smack', () => {
    expect(SCORE_DEFAULTS.attackExchange).toEqual(expect.arrayContaining([{ ch: 'lunge', at: 'start' }, { ch: 'impact', at: 'contact', offset: 0 }]));
  });

  it('runMomentCues fires the sfx channel and routes a real-death shake to onShake', () => {
    const death = vi.spyOn(sfx, 'death').mockImplementation(() => {});
    const c = ctx([{ type: 'death', target: 'a', side: 'enemy' }]);
    runMomentCues(moment('death', c.events), c);
    expect(death).toHaveBeenCalledTimes(1);
    expect(c.onShake).toHaveBeenCalledTimes(1);
  });

  it('runMomentCues fires the float channel for a damage moment', () => {
    const c = ctx([{ type: 'dmg', target: 'b', amount: 4, remainingHp: 2 }]);
    runMomentCues(moment('damage', c.events), c);
    // The float carries the anchor box `slotRectOf` reported at spawn — it renders board-level, not in the unit.
    expect(c.onFloats).toHaveBeenCalledWith([{ id: 0, uid: 'b', text: '4', kind: 'dmg', x: 0, y: 0, w: 100, h: 140 }]);
    expect(c.onDeathFloats).not.toHaveBeenCalled();
  });

  it('a moment with nothing to show fires no callbacks', () => {
    const c = ctx([{ type: 'reveal', target: 'a' }]);
    runMomentCues(moment('reveal', c.events), c);
    expect(c.onShake).not.toHaveBeenCalled();
    expect(c.onFloats).not.toHaveBeenCalled();
    expect(c.onDeathFloats).not.toHaveBeenCalled();
  });

  it('auraBurst + auraBreak are on every kind; auraReform is on the reborn kind (grouped effects not missed)', () => {
    for (const kind of ['damage', 'death', 'shieldPop', 'poisonTick', 'summon'] as const) {
      expect(SCORE_DEFAULTS[kind].some((c) => c.ch === 'auraBurst')).toBe(true);
      expect(SCORE_DEFAULTS[kind].some((c) => c.ch === 'auraBreak')).toBe(true);
    }
    expect(SCORE_DEFAULTS.reborn.some((c) => c.ch === 'auraReform')).toBe(true);
  });

  // The Execution Strike crescent. `poisonTick` covers BOTH the proc (`poison`) and the keyword being spent
  // (`venomLost`) — only the former is a kill worth slashing, so the handler scans for `poison` specifically.
  it('executeFx fires once per poison target', () => {
    const c = ctx([{ type: 'poison', target: 'b' }, { type: 'poison', target: 'c' }]);
    runMomentCues(moment('poisonTick', c.events), c);
    expect(c.onExecuteFx).toHaveBeenCalledWith(['b', 'c']);
  });

  it('executeFx does NOT fire on a venomLost-only moment (the keyword being spent is not a kill)', () => {
    const c = ctx([{ type: 'venomLost', target: 'b' }]);
    runMomentCues(moment('poisonTick', c.events), c);       // absorbed into a poison run
    expect(c.onExecuteFx).not.toHaveBeenCalled();
    const c2 = ctx([{ type: 'venomLost', target: 'b' }]);
    runMomentCues(moment('venomSpent', c2.events), c2);      // and as its own kind (the split)
    expect(c2.onExecuteFx).not.toHaveBeenCalled();
  });

  // The venomSpent/poisonTick split must not have cost the Execute crescent: both are RESULT_TYPES, so a
  // `[venomLost, poison]` run collapses into ONE moment whose primary is the venomLost — i.e. a `venomSpent`
  // moment that still CONTAINS a kill. It has to slash exactly as it did when both events shared a kind.
  it('executeFx still fires for a poison collapsed into a venomSpent moment', () => {
    const c = ctx([{ type: 'venomLost', target: 'b' }, { type: 'poison', target: 'b' }]);
    runMomentCues(moment('venomSpent', c.events), c);
    expect(c.onExecuteFx).toHaveBeenCalledWith(['b']);
  });

  // THE REGRESSION (owner report 2026-07-22: "i only see the original strike effect"). `poison` is a
  // RESULT_TYPE, so an Execute kill on an attack collapses into an `attackExchange` moment — its primary event
  // is `attack`, so the kind is NEVER `poisonTick`. Scoring executeFx on poisonTick alone meant it never fired
  // for the common case. It has to be on every kind, exactly like the aura channels.
  it('executeFx is scored on every kind EXCEPT attackExchange (where impact owns it)', () => {
    for (const [kind, cues] of Object.entries(SCORE_DEFAULTS)) {
      const want = kind !== 'attackExchange'; // attackExchange fires it from the impact channel, at contact
      expect(cues.some((c) => c.ch === 'executeFx'), kind).toBe(want);
    }
    // the kinds a collapsed poison actually lands in must all carry it
    for (const kind of ['damage', 'death', 'poisonTick', 'shieldPop', 'scCast'] as const) {
      expect(SCORE_DEFAULTS[kind].some((c) => c.ch === 'executeFx'), kind).toBe(true);
    }
  });

  it('fires executeFx for a poison absorbed into an attack-kind moment', () => {
    // the shape a real Execute kill compiles to: attack → dmg → poison → death, one moment, primary `attack`
    const c = ctx([
      { type: 'attack', attacker: 'a', defender: 'b', swing: 3 },
      { type: 'dmg', target: 'b', amount: 3, remainingHp: 1 },
      { type: 'poison', target: 'b' },
      { type: 'death', target: 'b', side: 'enemy' },
    ] as CombatEvent[]);
    // ...but on attackExchange the IMPACT channel owns it (fired at the lunge's real contact), so the cue
    // stands down here rather than double-slashing.
    runMomentCues(moment('attackExchange', c.events), c);
    expect(c.onExecuteFx).not.toHaveBeenCalled();
    // the same events in a NON-attack moment (a Start-of-Combat nuke) DO go through this path
    const c2 = ctx(c.events);
    runMomentCues(moment('damage', c2.events), c2);
    expect(c2.onExecuteFx).toHaveBeenCalledWith(['b']);
  });

  it('the migrated aura offsets reproduce the old channel delays', () => {
    const burst = SCORE_DEFAULTS.death.find((c) => c.ch === 'auraBurst')!;
    const brk = SCORE_DEFAULTS.shieldPop.find((c) => c.ch === 'auraBreak')!;
    const reform = SCORE_DEFAULTS.reborn.find((c) => c.ch === 'auraReform')!;
    expect(burst.offset ?? 0).toBe(0);
    expect(brk.offset).toBe(300);
    expect(brk.scaled ?? true).toBe(true);
    expect(reform.offset).toBe(460);
    expect(reform.scaled).toBe(false);
  });

  it('runMomentCues routes a real death → onAuraBurst (sync), a shield → onShieldBreak, a reborn → onReborn', () => {
    vi.useFakeTimers();
    const c1 = baseCtx([{ type: 'death', target: 'a', side: 'enemy' }] as CombatEvent[]);
    runMomentCues(moment('death', c1.events), c1);
    expect(c1.onAuraBurst).toHaveBeenCalledWith('a'); // burst offset 0 → synchronous
    const c2 = baseCtx([{ type: 'shield', target: 's' }] as CombatEvent[]);
    runMomentCues(moment('shieldPop', c2.events), c2);
    vi.advanceTimersByTime(300); // auraBreak +300ms scaled (speed 1)
    expect(c2.onShieldBreak).toHaveBeenCalledWith('s');
    const c3 = baseCtx([{ type: 'reborn', target: 'r', hp: 1, attack: 2, keywords: [] }] as CombatEvent[]);
    runMomentCues(moment('reborn', c3.events), c3);
    vi.advanceTimersByTime(460); // auraReform +460ms fixed
    expect(c3.onReborn).toHaveBeenCalledWith('r');
    vi.useRealTimers();
  });

  it('a rise death is not burst by the runner', () => {
    const c = baseCtx([{ type: 'death', target: 'r', side: 'enemy', rise: true }] as CombatEvent[]);
    runMomentCues(moment('riseDeath', c.events), c);
    expect(c.onAuraBurst).not.toHaveBeenCalled();
  });

  it('a start cue with offset 0 fires synchronously; a positive offset schedules by offset/speed', () => {
    vi.useFakeTimers();
    const c = baseCtx([{ type: 'shield', target: 's' }] as CombatEvent[], { combatSpeed: 2 });
    const cleanup = runMomentCues(moment('shieldPop', c.events), c);
    expect(c.onShieldBreak).not.toHaveBeenCalled();  // auraBreak 300 ÷2 = 150ms
    vi.advanceTimersByTime(149); expect(c.onShieldBreak).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2); expect(c.onShieldBreak).toHaveBeenCalledWith('s');
    cleanup(); vi.useRealTimers();
  });
  it('a scaled:false offset does NOT divide by speed (reborn re-form)', () => {
    vi.useFakeTimers();
    const c = baseCtx([{ type: 'reborn', target: 'r', hp: 1, attack: 2, keywords: [] }] as CombatEvent[], { combatSpeed: 2 });
    runMomentCues(moment('reborn', c.events), c);
    vi.advanceTimersByTime(459); expect(c.onReborn).not.toHaveBeenCalled();  // fixed 460 despite speed 2
    vi.advanceTimersByTime(2); expect(c.onReborn).toHaveBeenCalledWith('r');
    vi.useRealTimers();
  });
  it('the returned cleanup cancels a pending offset timer', () => {
    vi.useFakeTimers();
    const c = baseCtx([{ type: 'shield', target: 's' }] as CombatEvent[], { combatSpeed: 1 });
    const cleanup = runMomentCues(moment('shieldPop', c.events), c);
    cleanup(); vi.advanceTimersByTime(1000);
    expect(c.onShieldBreak).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('getScore returns defaults when there are no overrides', () => {
    resetScore();
    expect(getScore().death.map((c) => c.ch)).toEqual(SCORE_DEFAULTS.death.map((c) => c.ch));
  });
  it('setCue overrides one cue field and persists; resetScore clears it', () => {
    resetScore();
    setCue('shieldPop', 'auraBreak', { offset: 120 });
    expect(getCues('shieldPop').find((c) => c.ch === 'auraBreak')!.offset).toBe(120);
    resetScore();
    expect(getCues('shieldPop').find((c) => c.ch === 'auraBreak')!.offset).toBe(300);
  });
  it('scoreJson round-trips to an effective table reflecting overrides', () => {
    resetScore();
    setCue('death', 'auraBurst', { offset: 50 });
    const json = JSON.parse(scoreJson());
    expect(json.death.find((c: { ch: string; offset: number }) => c.ch === 'auraBurst').offset).toBe(50);
    resetScore();
  });

  it('runMomentCues routes a self-buff (source === target) → onSelfBuffs', () => {
    const c = ctx([{ type: 'buff', target: 'a', source: 'a', attack: 2, health: 1 }]);
    runMomentCues(moment('buffWave', c.events), c);
    expect(c.onSelfBuffs).toHaveBeenCalledWith([{ uid: 'a', attack: 2, health: 1 }]);
  });

  it('does NOT call onSelfBuffs for a buff-other (source !== target)', () => {
    const c = ctx([{ type: 'buff', target: 'a', source: 'b', attack: 2, health: 1 }]);
    runMomentCues(moment('buffWave', c.events), c);
    expect(c.onSelfBuffs).not.toHaveBeenCalled();
  });

  it('runMomentCues routes an improve moment → onImprove with the strengthened targets', () => {
    const c = ctx([{ type: 'improve', target: 'k', amount: 1 }, { type: 'improve', target: 'm', amount: 2 }]);
    runMomentCues(moment('improve', c.events), c);
    expect(c.onImprove).toHaveBeenCalledWith(['k', 'm']);
  });

  it('the improveSelf cue is NOT on the attackExchange kind (an absorbed improve rides the self-buff pulse instead)', () => {
    expect(SCORE_DEFAULTS.improve.some((c) => c.ch === 'improveSelf')).toBe(true);
    expect(SCORE_DEFAULTS.attackExchange.some((c) => c.ch === 'improveSelf')).toBe(false);
  });

  it('runMomentCues routes a maxGold moment → onMaxGold with the gaining units', () => {
    const c = ctx([{ type: 'maxGold', target: 'g', side: 'player', amount: 2 }]);
    runMomentCues(moment('maxGold', c.events), c);
    expect(c.onMaxGold).toHaveBeenCalledWith(['g']);
  });

  it('a damage moment (non-melee dmg) → onDamageFx with the unique hit targets', () => {
    const c = ctx([
      { type: 'dmg', target: 'x', amount: 3, remainingHp: 0 },
      { type: 'dmg', target: 'y', amount: 2, remainingHp: 1 },
      { type: 'dmg', target: 'x', amount: 1, remainingHp: 0 }, // second hit on x → deduped
    ]);
    runMomentCues(moment('damage', c.events), c);
    expect(c.onDamageFx).toHaveBeenCalledWith(['x', 'y']);
  });

  it('melee dmg (attackExchange) does NOT route to onDamageFx — the attack owns its impact FX', () => {
    const c = ctx([{ type: 'attack', attacker: 'a', defender: 'b', swing: 0 }, { type: 'dmg', target: 'b', amount: 3, remainingHp: 0 }]);
    runMomentCues(moment('attackExchange', c.events), c);
    expect(c.onDamageFx).not.toHaveBeenCalled();
  });

  // The test above only proves the ATTACK moment has no damageFx cue — trivially true, and it is NOT where
  // melee damage lives. A clash's `dmg` events collapse into the SEPARATE `damage` moment that follows, and
  // that moment DOES carry the cue. Nothing filtered the melee pair there, so the strike played a second
  // time on the defender and a third on the attacker (which takes retaliation damage in the same moment) —
  // the owner's "two strike animations" (2026-07-21). These cover the real path.
  it('the damage moment FOLLOWING an attack skips both clash units — their FX rode the impact channel', () => {
    const c = ctx([
      { type: 'dmg', target: 'b', amount: 3, remainingHp: 0 }, // the defender's hit
      { type: 'dmg', target: 'a', amount: 2, remainingHp: 1 }, // the attacker's retaliation
    ], { meleePair: { attacker: 'a', defender: 'b' } });
    runMomentCues(moment('damage', c.events), c);
    expect(c.onDamageFx).not.toHaveBeenCalled();
  });

  it('Cleave splash still bursts — only the clash pair is covered by the impact channel', () => {
    const c = ctx([
      { type: 'dmg', target: 'b', amount: 3, remainingHp: 0 },     // defender
      { type: 'dmg', target: 'a', amount: 2, remainingHp: 1 },     // attacker retaliation
      { type: 'dmg', target: 'nbr', amount: 3, remainingHp: 2 },   // Cleave neighbour — no impact FX of its own
    ], { meleePair: { attacker: 'a', defender: 'b' } });
    runMomentCues(moment('damage', c.events), c);
    expect(c.onDamageFx).toHaveBeenCalledWith(['nbr']);
  });

  it('an ascend moment → onAscend with the transforming unit', () => {
    const c = ctx([{ type: 'ascend', target: 'tara', into: 'taragosa' }] as CombatEvent[]);
    runMomentCues(moment('ascend', c.events), c);
    expect(c.onAscend).toHaveBeenCalledWith(['tara']);
  });

  it('a summon moment → onSummonFx with the summoned uid, AFTER the +250ms bounce offset', () => {
    vi.useFakeTimers();
    const c = ctx([{ type: 'summon', side: 'player', index: 0, minion: { uid: 'z', cardId: 'alley', name: 'Alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false } }] as CombatEvent[]);
    runMomentCues(moment('summon', c.events), c);
    expect(c.onSummonFx).not.toHaveBeenCalled(); // offset 250 → scheduled, not synchronous
    vi.advanceTimersByTime(250);
    expect(c.onSummonFx).toHaveBeenCalledWith(['z']);
    vi.useRealTimers();
  });
});

describe('momentKind → score coverage (every CombatEvent type maps to an iterable score entry)', () => {
  // Regression for the "cues is not iterable" crash: an unhandled event type made `momentKind` return
  // undefined, so `getScore()[undefined]` was not iterable (Tauntbreaker's keywordLost; Guel's spellProgress).
  const sample: CombatEvent[] = [
    { type: 'attack', attacker: 'a', defender: 'b', swing: 0 },
    { type: 'dmg', target: 'b', amount: 1, remainingHp: 0 },
    { type: 'shield', target: 'b' }, { type: 'shieldUp', target: 'b' },
    { type: 'poison', target: 'b' }, { type: 'venomLost', target: 'b' },
    { type: 'death', target: 'b' }, { type: 'death', target: 'b', rise: true },
    { type: 'sc', source: 'a', text: 'x' }, { type: 'sc', source: 'a', text: 'x', cast: true },
    { type: 'summon', side: 'player', index: 0, minion: { uid: 'z', cardId: 'alley', name: 'Alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false } },
    { type: 'buff', target: 'b', source: 'a', attack: 1, health: 1 },
    { type: 'reborn', target: 'b', attack: 1, hp: 1, keywords: [] },
    { type: 'ascend', target: 'b', into: 'taragosa' }, { type: 'rally', source: 'a', target: 'b' },
    { type: 'toHand', cardId: 'growth' }, { type: 'maxGold', target: 'b', amount: 1 },
    { type: 'improve', target: 'b', amount: 1 },
    { type: 'keyword', target: 'b', keyword: 'DS' }, { type: 'keywordLost', target: 'b', keyword: 'T' },
    { type: 'hpGrant', target: 'b', amount: 2 }, { type: 'spellProgress', target: 'b', amount: 3 },
    { type: 'reveal', target: 'b' }, { type: 'tribeAura', side: 'player', tribe: 'beast', attack: 1 },
    // Quest/rune beats: these used to hit `momentKind`'s `damage` fallthrough. They have their own kinds now, so
    // this row also guards against a kind being added without its score entry (the "cues is not iterable" crash).
    { type: 'questTrigger', flag: 'f', side: 'player' }, { type: 'questComplete', questId: 'q', side: 'player' },
  ] as CombatEvent[];

  it('every event type yields a defined, iterable score entry (never crashes runMomentCues)', () => {
    const score = getScore();
    for (const e of sample) {
      const kind = momentKind(e);
      expect(score[kind]).toBeDefined(); // getScore()[kind] must be iterable, not undefined
      expect(Array.isArray(score[kind])).toBe(true);
    }
  });
});

// ── the `fxDef` channel (authored FX defs) ──────────────────────────────────────────────────────────────
const shieldUpMoment = (): Moment => moment('shieldGain', [{ type: 'shieldUp', target: 'b' }] as CombatEvent[]);

// THE binding table lives in `bindings.json` and is asserted in `bindings.test.ts`. What this file owns is
// that the score gives every kind a TIMING row to hang a binding on, and that the rows are ordered correctly.
describe('fxDef channel', () => {
  beforeEach(() => {
    // The suite-wide `restoreAllMocks` strips these module mocks' implementations — restate them per test.
    mockPlayDef.mockReset(); mockPlayDef.mockImplementation(() => () => {});
    mockCanPlayDefs.mockReset(); mockCanPlayDefs.mockImplementation(() => true);
    mockAnchors.mockReset(); mockAnchors.mockImplementation(() => ({ target: { x: 5, y: 7 } }));
    resetScore();
  });
  afterEach(() => resetScore());

  // Every kind carries a timing row, so a binding added to `bindings.json` is SUFFICIENT to make it play.
  // Before this, a def bound to a kind whose cue list happened to lack an `fxDef` entry silently played
  // nothing.
  it('gives every moment kind exactly one fxDef timing row', () => {
    for (const [kind, cues] of Object.entries(SCORE_DEFAULTS)) {
      expect(cues.filter((c) => c.ch === 'fxDef').length, kind).toBe(1);
    }
  });

  // ORDER, not just presence. Both cues sit at `start` with offset 0, so they fire synchronously in list
  // order within one `runMomentCues` call — and a `fanOut: 'damaged'` binding CLAIMS the units it covers
  // synchronously, which only suppresses the stock hit-burst if `fxDef` runs first. Nothing exercises this
  // today (no `damaged` binding sits at a kind that also carries `damageFx`), which is exactly why a future
  // reorder of `BASE` would break it silently rather than turning a test red.
  it('runs the fxDef row BEFORE damageFx, so a claim is standing when the stock burst reads it', () => {
    const chans = SCORE_DEFAULTS.damage.map((c) => c.ch);
    expect(chans.indexOf('fxDef')).toBeGreaterThanOrEqual(0);
    expect(chans.indexOf('fxDef')).toBeLessThan(chans.indexOf('damageFx'));
  });

  // Every kinds split must not have cost the moments that MOVED anything they already played: the new kind
  // carries its predecessor's exact cue list, in order — and holds for the same time. (The fxDef row is on
  // both, from BASE, so the lists are now identical rather than differing by one entry.)
  it.each([
    ['shieldGain', 'shieldPop'],    // Ward gained ← Ward consumed
    ['venomSpent', 'poisonTick'],   // Venom spent ← the Execute proc
    ['questTrigger', 'damage'],     // quest tick   ← the `damage` fallthrough (damageFx rides along, inert)
    ['questComplete', 'damage'],
  ] as const)('%s keeps every cue %s had — the split is purely additive', (next, prev) => {
    expect(SCORE_DEFAULTS[next].map((c) => c.ch)).toEqual(SCORE_DEFAULTS[prev].map((c) => c.ch));
    expect(holdMsForKind(next)).toBe(holdMsForKind(prev)); // and the pacing is identical
  });

  // The `sc` split runs the other way: the NEW kind (narration) is the one that gains nothing, and the existing
  // name narrows to `cast: true`. Narration keeps precisely the cues `scCast` has; only the BINDING differs.
  it('scNarrate keeps exactly the cues scCast has, and stays unbound', () => {
    expect(SCORE_DEFAULTS.scNarrate.map((c) => c.ch)).toEqual(SCORE_DEFAULTS.scCast.map((c) => c.ch));
    expect(holdMsForKind('scNarrate')).toBe(holdMsForKind('scCast'));
    expect(bindingFor(null, 'scNarrate')).toBeNull();
    expect(bindingFor(null, 'scCast')).toEqual({ def: 'spell-cast' });
  });

  it('dispatches the channel: plays the cue def with the resolved anchors', () => {
    const c = baseCtx([{ type: 'shieldUp', target: 'b' }] as CombatEvent[]);
    runMomentCues(shieldUpMoment(), c);
    // a shieldUp carries a target but no source → the missing side is passed as null
    expect(mockAnchors).toHaveBeenCalledWith(null, 'b');
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    expect(mockPlayDef).toHaveBeenCalledWith('ward-gained', { target: { x: 5, y: 7 } },
      // the uids ride alongside the anchors so a `react` layer can find the CARD, not just the point
      { uids: { source: null, target: 'b' } });
  });

  it('no-ops when canPlayDefs() is false (production: defs do not ship)', () => {
    mockCanPlayDefs.mockReturnValue(false);
    const c = baseCtx([{ type: 'shieldUp', target: 'b' }] as CombatEvent[]);
    runMomentCues(shieldUpMoment(), c);
    expect(mockPlayDef).not.toHaveBeenCalled();
    expect(mockAnchors).not.toHaveBeenCalled(); // bails BEFORE resolving anchors — costs nothing
  });

  it('plays nothing at a kind with no binding', () => {
    const c = ctx([{ type: 'sc', source: 'a', text: 'x' }] as CombatEvent[]);
    const stop = runMomentCues(moment('scNarrate', c.events), c);
    expect(mockPlayDef).not.toHaveBeenCalled();
    stop();
  });

  it('skips silently when the anchors are null (the unit already left the screen)', () => {
    mockAnchors.mockReturnValue(null);
    const c = baseCtx([{ type: 'shieldUp', target: 'b' }] as CombatEvent[]);
    expect(() => runMomentCues(shieldUpMoment(), c)).not.toThrow();
    expect(mockPlayDef).not.toHaveBeenCalled();
  });

  // An unknown def id is `playDef`'s own null return — a build without ward-gained.json must not throw here.
  it('tolerates an unknown def (playDef returns null)', () => {
    mockPlayDef.mockReturnValue(null);
    const c = baseCtx([{ type: 'shieldUp', target: 'b' }] as CombatEvent[]);
    expect(() => runMomentCues(shieldUpMoment(), c)).not.toThrow();
    expect(mockPlayDef).toHaveBeenCalledWith('ward-gained', expect.anything(), expect.anything());
  });

  it('honours `enabled: false`', () => {
    setCue('shieldGain', 'fxDef', { enabled: false });
    const c = baseCtx([{ type: 'shieldUp', target: 'b' }] as CombatEvent[]);
    runMomentCues(shieldUpMoment(), c);
    expect(mockPlayDef).not.toHaveBeenCalled();
  });

  it('honours `offset`, scaled by combatSpeed like every other cue, and cancels on cleanup', () => {
    vi.useFakeTimers();
    setCue('shieldGain', 'fxDef', { offset: 200 });
    const c = baseCtx([{ type: 'shieldUp', target: 'b' }] as CombatEvent[], { combatSpeed: 2 });
    const cleanup = runMomentCues(shieldUpMoment(), c);
    expect(mockPlayDef).not.toHaveBeenCalled();        // 200 ÷ 2 = 100ms
    vi.advanceTimersByTime(99); expect(mockPlayDef).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2); expect(mockPlayDef).toHaveBeenCalledTimes(1);
    cleanup();
    // and a pending one is cancelled
    mockPlayDef.mockClear();
    const c2 = baseCtx([{ type: 'shieldUp', target: 'b' }] as CombatEvent[], { combatSpeed: 1 });
    runMomentCues(shieldUpMoment(), c2)();
    vi.advanceTimersByTime(1000);
    expect(mockPlayDef).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('a `scaled: false` offset is fixed wall-clock', () => {
    vi.useFakeTimers();
    setCue('shieldGain', 'fxDef', { offset: 300, scaled: false });
    const c = baseCtx([{ type: 'shieldUp', target: 'b' }] as CombatEvent[], { combatSpeed: 3 });
    runMomentCues(shieldUpMoment(), c);
    vi.advanceTimersByTime(299); expect(mockPlayDef).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2); expect(mockPlayDef).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  // The channel is generic: it reads the units off the moment's PRIMARY event, whatever that event is. An
  // `attack` names its pair attacker/defender rather than source/target, so it gets its own resolution branch.
  it('resolves an attack primary to its attacker/defender pair', () => {
    const events = [{ type: 'attack', attacker: 'a', defender: 'd', swing: 0 }] as CombatEvent[];
    const c = baseCtx(events);
    // a `shieldGain`-scored moment whose primary happens to be an attack — exercises the resolution, not the binding
    runMomentCues({ start: 0, end: 1, primary: events[0]!, stepGroups: [[0]], kind: 'shieldGain' }, c);
    expect(mockAnchors).toHaveBeenCalledWith('a', 'd');
  });

  // ── one row per binding: the real primary event → the right def, at the right anchors ──────────────────
  // The kind is taken from `momentKind(event)`, not hardcoded, so a row also proves the CLASSIFICATION reaches
  // the binding (a kind split that forgot its case would bind the def on a kind no event ever produces).
  // `[source, target]` is what `anchorsForUnits` receives: `null` = "this moment has no such end", which folds
  // onto the other end (see combatAnchors.ts). Both null = no anchors at all in the real DOM.
  it.each([
    [{ type: 'shieldUp', target: 'b' }, 'shieldGain', 'ward-gained', [null, 'b']],
    [{ type: 'venomLost', target: 'b' }, 'venomSpent', 'venom-spent', [null, 'b']],
    // the CASTER: an `sc` carries a source and no target, so the flash folds onto the unit that cast
    [{ type: 'sc', source: 'a', text: 'zap', cast: true }, 'scCast', 'spell-cast', ['a', null]],
    [{ type: 'reveal', target: 'b' }, 'reveal', 'stealth-break', [null, 'b']],
    [{ type: 'keyword', target: 'b', keyword: 'DS' }, 'keyword', 'keyword-gain', [null, 'b']],
    [{ type: 'keywordLost', target: 'b', keyword: 'T' }, 'keywordLost', 'keyword-lost', [null, 'b']],
    // NB: `rally` is deliberately NOT a row here. It is the one genuinely two-ended beat, and it belongs to
    // the `rallyFx` channel rather than to this one — see the `rallyFx channel` describe below for why, and
    // for the assertion that this channel stands down on the `rally` kind so the two can never both fire.
    [{ type: 'toHand', cardId: 'z', side: 'player', source: 'a' }, 'toHand', 'to-hand', ['a', null]],
    [{ type: 'hpGrant', target: 'b', amount: 2 }, 'hpGrant', 'hp-grant', [null, 'b']],
    [{ type: 'spellProgress', target: 'b', amount: 3 }, 'spellProgress', 'spell-progress', [null, 'b']],
  ] as [CombatEvent, MomentKind, string, [string | null, string | null]][])(
    'plays %o as a %s moment → its def at the right anchors', (event, kind, def, [source, target]) => {
      expect(momentKind(event)).toBe(kind);
      const c = baseCtx([event]);
      runMomentCues(moment(kind, c.events), c);
      expect(mockAnchors).toHaveBeenCalledWith(source, target);
      expect(mockPlayDef).toHaveBeenCalledTimes(1);
      expect(mockPlayDef).toHaveBeenCalledWith(def, { target: { x: 5, y: 7 } }, { uids: { source, target } });
    },
  );

  // A `toHand` with no source (a quest's reward card) and the two quest beats name NO unit at all, so the real
  // `anchorsForUnits(null, null)` returns null and the def skips silently — the mock returns anchors here so the
  // wiring is still asserted, which is the point: the binding is correct and simply dormant until the score can
  // anchor these to a badge/HUD node. Flagged in score.ts.
  it.each([
    [{ type: 'toHand', cardId: 'z', side: 'player' }, 'toHand', 'to-hand'],
    [{ type: 'questTrigger', flag: 'f', side: 'player' }, 'questTrigger', 'quest-trigger'],
    [{ type: 'questComplete', questId: 'q', side: 'player' }, 'questComplete', 'quest-complete'],
  ] as [CombatEvent, MomentKind, string][])('resolves %o to no unit end (dormant until it can anchor)', (event, kind, def) => {
    expect(momentKind(event)).toBe(kind);
    const c = baseCtx([event]);
    runMomentCues(moment(kind, c.events), c);
    expect(mockAnchors).toHaveBeenCalledWith(null, null);
    expect(mockPlayDef).toHaveBeenCalledWith(def, expect.anything(), { uids: { source: null, target: null } });
  });

  // THE TRAP each split exists to close (the shieldGain/shieldPop template): the neighbouring kind — the one the
  // events were split OUT of, and the one that already owns FX — must stay silent. Without the split, every one
  // of these would fire the sibling's def on the wrong beat: `poison` (an Execute KILL) would play "venom spent",
  // a spell-power narration line would flash a caster muzzle, and every hit in the fight would play a quest tick.
  it.each([
    [{ type: 'shield', target: 'b' }, 'shieldPop'],          // Ward CONSUMED — must not play `ward-gained`
    [{ type: 'poison', target: 'b' }, 'poisonTick'],         // Execute proc — must not play `venom-spent`
    [{ type: 'sc', source: 'a', text: '+1/+1 Spell Power' }, 'scNarrate'], // narration — must not play `spell-cast`
    [{ type: 'dmg', target: 'b', amount: 3, remainingHp: 1 }, 'damage'],   // a real hit — must not play a quest def
    [{ type: 'death', target: 'b', side: 'enemy' }, 'death'], // plain death — the dissolve is NOT scored here
    [{ type: 'attack', attacker: 'a', defender: 'b', swing: 0 }, 'attackExchange'],
  ] as [CombatEvent, MomentKind][])('does NOT fire any def for %o (the neighbouring kind stays silent)', (event, kind) => {
    expect(momentKind(event)).toBe(kind);
    const c = baseCtx([event]);
    runMomentCues(moment(kind, c.events), c);
    expect(mockPlayDef).not.toHaveBeenCalled();
  });
});

// The persisted score is a shared, cross-version blob (`localStorage['ascent.choreoScore']`): a score written
// by a NEWER build (new kinds/channels/fields) must not break an OLDER one, and vice versa. NOTE: the suite
// runs in bare node (no jsdom), so `localStorage` is undefined and score.ts's try/catch swallows every access
// — the write-back test below installs a minimal stub to exercise the real persistence path.
const withLocalStorage = (fn: (store: Map<string, string>) => void): void => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { localStorage?: unknown };
  const had = 'localStorage' in g;
  const prev = g.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    configurable: true, writable: true,
  });
  try { fn(store); } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', { value: prev, configurable: true, writable: true });
    else delete g.localStorage;
  }
};

describe('score persistence tolerates unknown kinds/channels (cross-version round-trip)', () => {
  afterEach(() => resetScore());

  it('an unknown channel or kind in the overrides is ignored, not thrown on', () => {
    resetScore();
    setCue('shieldPop', 'notAChannel' as Channel, { offset: 999 });   // a channel this build doesn't know
    setCue('notAKind' as MomentKind, 'sfx', { offset: 999 });         // a kind this build doesn't know
    expect(() => getScore()).not.toThrow();
    expect(() => scoreJson()).not.toThrow();
    // the real cues are untouched by the junk, and no phantom kind appears in the effective score
    expect(getCues('shieldPop').find((c) => c.ch === 'auraBreak')!.offset).toBe(300);
    expect(Object.keys(getScore())).not.toContain('notAKind');
    const c = baseCtx([{ type: 'shield', target: 's' }] as CombatEvent[]);
    expect(() => runMomentCues(moment('shieldPop', c.events), c)).not.toThrow();
  });

  it("an unknown override is PRESERVED on write-back — an older build cannot drop a newer build's score", () => {
    withLocalStorage((store) => {
      resetScore();
      setCue('notAKind' as MomentKind, 'sfx', { offset: 999 });   // "written by a newer build"
      setCue('death', 'auraBurst', { offset: 42 });                // an older build then edits its own cue
      const raw = JSON.parse(store.get('ascent.choreoScore') ?? '{}');
      expect(raw.notAKind).toEqual({ sfx: { offset: 999 } });      // still there — merged, not clobbered
      expect(raw.death).toEqual({ auraBurst: { offset: 42 } });
      expect(getCues('death').find((c) => c.ch === 'auraBurst')!.offset).toBe(42);
    });
  });

  it('every kind round-trips its fxDef timing row through the effective score', () => {
    resetScore();
    const json = JSON.parse(scoreJson()) as Record<string, { ch: string }[]>;
    // EVERY kind, not just the bound ones: the row is universal now, and the effective score is what the
    // persistence path serialises — a kind that lost its timing row there would silently lose its FX for
    // anyone with a saved score, including one bound later.
    for (const kind of Object.keys(SCORE_DEFAULTS)) {
      expect(json[kind]?.some((c) => c.ch === 'fxDef'), kind).toBe(true);
    }
  });
});

/**
 * The per-card override, dispatched from the cue runner. The TABLE it resolves through is `bindings.json`'s
 * `cards` section (asserted in bindings.test.ts); what these cases own is that the runner reads it at all, and
 * fans out correctly. Bloodbinder's bleed shares the `scCast` kind with every other spell cast, so the card
 * id is the only key that can tell them apart.
 */
describe('fxDef channel — per-card bindings', () => {
  it("plays the CARD's def instead of the kind default when the source card has a binding", () => {

    const events: CombatEvent[] = [
      { type: 'sc', source: 'a', text: 'Bloodbinder bleeds', cast: true } as CombatEvent,
      { type: 'dmg', target: 'e1', amount: 5 } as CombatEvent,
      { type: 'dmg', target: 'e2', amount: 5 } as CombatEvent,
    ];
    runMomentCues(moment('scCast', events), baseCtx(events, withCard('a', 'bloodbinder')));
    // fanOut 'damaged': one play per damaged unit, all with the card's def, never the kind's `spell-cast`.
    expect(mockPlayDef).toHaveBeenCalledTimes(2);
    expect(mockPlayDef.mock.calls.every((c) => c[0] === 'ruby-lance')).toBe(true);
    expect(mockAnchors).toHaveBeenCalledWith('a', 'e1');
    expect(mockAnchors).toHaveBeenCalledWith('a', 'e2');
  });

  it('falls back to the kind default for a card with no binding', () => {

    const events: CombatEvent[] = [{ type: 'sc', source: 'a', text: 'zap', cast: true } as CombatEvent];
    runMomentCues(moment('scCast', events), baseCtx(events, withCard('a', 'someothercard')));
    expect(mockPlayDef).toHaveBeenCalledWith('spell-cast', expect.anything(), expect.anything());
  });

  // A proc that damaged nobody (every mark already dead) must play nothing rather than collapsing onto the
  // caster, which is what a targetless travelling effect would otherwise do.
  it('plays nothing when a fan-out moment damaged no one', () => {

    const events: CombatEvent[] = [{ type: 'sc', source: 'a', text: 'Bloodbinder bleeds', cast: true } as CombatEvent];
    runMomentCues(moment('scCast', events), baseCtx(events, withCard('a', 'bloodbinder')));
    expect(mockPlayDef).not.toHaveBeenCalled();
  });
});

/** End-to-end: the authored effect fires AND the stock orange hit-burst is skipped for the units it covers. */
describe('fxDef channel — an authored effect replaces the stock damageFx burst', () => {
  it('suppresses onDamageFx for the units the per-card effect covers', () => {

    const events: CombatEvent[] = [
      { type: 'sc', source: 'a', text: 'Bloodbinder bleeds', cast: true, step: 4 } as CombatEvent,
      { type: 'dmg', target: 'e1', amount: 5, step: 4 } as CombatEvent,
    ];
    const ctx = baseCtx(events, withCard('a', 'bloodbinder'));
    // The cast moment claims; the separate damage moment then finds its target already covered.
    runMomentCues(moment('scCast', events), ctx);
    runMomentCues({ start: 1, end: 2, primary: events[1]!, stepGroups: [[1]], kind: 'damage' }, ctx);
    expect(ctx.onDamageFx).not.toHaveBeenCalled();
  });

  it('leaves the stock burst alone for a card with no binding', () => {

    const events: CombatEvent[] = [
      { type: 'sc', source: 'a', text: 'zap', cast: true, step: 5 } as CombatEvent,
      { type: 'dmg', target: 'e1', amount: 5, step: 5 } as CombatEvent,
    ];
    const ctx = baseCtx(events, withCard('a', 'someothercard'));
    runMomentCues(moment('scCast', events), ctx);
    runMomentCues({ start: 1, end: 2, primary: events[1]!, stepGroups: [[1]], kind: 'damage' }, ctx);
    expect(ctx.onDamageFx).toHaveBeenCalledWith(['e1']);
  });

  // Fel Spikes' Echo is `launchOnDeath`: the projectile is NOT played on the damage beat (it launched a beat
  // earlier from the dying body — see useCombatReplay). But the fan-out STILL runs here to CLAIM its victims, so
  // the stock hit-burst the spike replaces is suppressed. So: no play, but onDamageFx silenced for the wave.
  it('a launchOnDeath wave (Fel Spikes) CLAIMS its victims but does not play here (relocated to the death)', () => {
    const events: CombatEvent[] = [
      { type: 'dmg', target: 'e1', amount: 4, remainingHp: 1, source: 'fs', step: 8 } as CombatEvent,
      { type: 'dmg', target: 'e2', amount: 4, remainingHp: 2, source: 'fs', step: 8 } as CombatEvent,
    ];
    const ctx = baseCtx(events, withCard('fs', 'dm_felspikes'));
    runMomentCues({ start: 0, end: 2, primary: events[0]!, stepGroups: [[0, 1]], kind: 'damage' }, ctx);
    expect(mockPlayDef).not.toHaveBeenCalled();     // launched from the death handler, not here
    expect(ctx.onDamageFx).not.toHaveBeenCalled();  // e1, e2 claimed → stock burst still suppressed
  });

  // A melee attack's impact is ALSO a `damage` moment sourced by the attacker; the volley must NOT fire on
  // Fel Spikes' own swing (owner report 2026-08-20) — only on its Echo spray, which is not an attack.
  it('does NOT fire on the unit\'s own melee swing (the impact is a damage moment with a meleePair)', () => {
    const events: CombatEvent[] = [
      { type: 'dmg', target: 'e1', amount: 4, remainingHp: 1, source: 'fs', step: 3 } as CombatEvent, // fs hits e1
      { type: 'dmg', target: 'fs', amount: 2, remainingHp: 1, source: 'e1', step: 3 } as CombatEvent, // e1 retaliates
    ];
    const ctx = baseCtx(events, { ...withCard('fs', 'dm_felspikes'), meleePair: { attacker: 'fs', defender: 'e1' } });
    runMomentCues({ start: 0, end: 2, primary: events[0]!, stepGroups: [[0, 1]], kind: 'damage' }, ctx);
    expect(mockPlayDef).not.toHaveBeenCalled();
  });

  // The claim must still cover a WARD-blocked victim (a `shield`, no `dmg`) even when the wave leads with one —
  // otherwise nothing suppresses its (absent) stock burst and, more importantly, the `struck` set the death
  // handler reads to fire spikes would disagree. The dealer is recovered from the first `dmg`'s source.
  it('a Ward-led launchOnDeath wave still claims every struck unit (no play here)', () => {
    const events: CombatEvent[] = [
      { type: 'shield', target: 'e1', step: 9 } as CombatEvent,
      { type: 'dmg', target: 'e2', amount: 4, remainingHp: 1, source: 'fs', step: 9 } as CombatEvent,
    ];
    const ctx = baseCtx(events, withCard('fs', 'dm_felspikes'));
    runMomentCues({ start: 0, end: 2, primary: events[0]!, stepGroups: [[0, 1]], kind: 'damage' }, ctx);
    expect(mockPlayDef).not.toHaveBeenCalled();     // relocated to the death handler
    expect(ctx.onDamageFx).not.toHaveBeenCalled();  // e2 claimed; e1 is a ward pop with no stock burst
  });
});

/**
 * The self-buff fan-out — now SILENT. Its generic `self-buff-gold` binding (on `buffWave` and `attackExchange`)
 * was REMOVED 2026-09-02 (owner ask: every stock shop/combat buff cue is being replaced by an authored pixi
 * effect). The moments still fire — a Target Dummy still grows as it is hit — but with nothing bound to them,
 * the fan-out plays no def. These are the regression guards that the generic cue stays gone: if a def is ever
 * re-bound to either kind, the "plays nothing" assertions here go red.
 */
describe('fxDef channel — self-buff fan-out (generic def removed)', () => {
  const selfBuff = (uid: string): CombatEvent =>
    ({ type: 'buff', source: uid, target: uid, attack: 1, health: 0 }) as CombatEvent;
  const buffOther = (src: string, tgt: string): CombatEvent =>
    ({ type: 'buff', source: src, target: tgt, attack: 1, health: 0 }) as CombatEvent;

  it('plays nothing for SELF-buffed units now the generic def is unbound', () => {
    const events = [selfBuff('u1'), selfBuff('u2')];
    runMomentCues(moment('buffWave', events), baseCtx(events));
    expect(mockPlayDef).not.toHaveBeenCalled();
  });

  // Buff-OTHER is the tendril channel's job; it has a real source→target pair and must not bloom on itself.
  it('ignores a buff aimed at somebody else', () => {
    const events = [buffOther('a', 'b')];
    runMomentCues(moment('buffWave', events), baseCtx(events));
    expect(mockPlayDef).not.toHaveBeenCalled();
  });

  // THE case the owner named: a Target Dummy growing as it is hit is ABSORBED into the wind-up and never
  // produces a buffWave moment of its own. It used to bloom `self-buff-gold`; now it plays nothing.
  it('plays nothing for a self-buff absorbed into an attack exchange', () => {
    const events: CombatEvent[] = [
      { type: 'attack', attacker: 'a', defender: 'b' } as CombatEvent,
      selfBuff('b'),
    ];
    runMomentCues(moment('attackExchange', events), baseCtx(events));
    expect(mockPlayDef).not.toHaveBeenCalled();
  });

  it('plays nothing on the overwhelming majority of exchanges, which carry no self-buff', () => {
    const events: CombatEvent[] = [{ type: 'attack', attacker: 'a', defender: 'b' } as CombatEvent];
    runMomentCues(moment('attackExchange', events), baseCtx(events));
    expect(mockPlayDef).not.toHaveBeenCalled();
  });
});

/** The cross-buff fan-out: one play per unit the SOURCE empowered, anchored source→each target (Karwind → flame-ring). */
describe('fxDef channel — buffed (cross-buff) fan-out', () => {
  const buffOther = (src: string, tgt: string): CombatEvent =>
    ({ type: 'buff', source: src, target: tgt, attack: 3, health: 3 }) as CombatEvent;
  const selfBuff = (uid: string): CombatEvent =>
    ({ type: 'buff', source: uid, target: uid, attack: 1, health: 0 }) as CombatEvent;

  beforeEach(() => { mockPlayDef.mockClear(); mockAnchors.mockClear(); mockCanPlayDefs.mockReturnValue(true); });

  it("plays the card's def once per unit it buffed, anchored source→each target", () => {
    const events = [buffOther('k', 'd1'), buffOther('k', 'd2')];
    runMomentCues(moment('buffWave', events), baseCtx(events, withCard('k', 'karwind')));
    expect(mockPlayDef).toHaveBeenCalledTimes(2);
    expect(mockPlayDef.mock.calls.every((c) => c[0] === 'flame-ring')).toBe(true);
    expect(mockAnchors).toHaveBeenCalledWith('k', 'd1');
    expect(mockAnchors).toHaveBeenCalledWith('k', 'd2');
  });

  // A self-buff is the OTHER channel's job — the buffed fan-out rides only source→target (cross) buffs.
  it('ignores a self-buff in the same moment', () => {
    const events = [selfBuff('k')];
    runMomentCues(moment('buffWave', events), baseCtx(events, withCard('k', 'karwind')));
    expect(mockPlayDef).not.toHaveBeenCalled();
  });
});

/**
 * The `rallyFx` channel — a Rally's authored flourish, resolved PER RALLY EVENT.
 *
 * Why it is not just an `fxDef` binding is the whole point of these tests: every Rally is an `onAttack`
 * trigger, so `absorbIntoWindup` folds its event into the attacker's exchange and the `rally` KIND never
 * occurs in a real fight. `fxDef` resolves one binding off the moment's PRIMARY event, so for a real Rally it
 * would have asked for `attackExchange` at the attacker and anchored the def to the DEFENDER — the wrong
 * question and the wrong unit. That is why `kinds.rally` sat authored and unplayed for as long as it existed.
 */
describe('rallyFx channel', () => {
  const rally = (source: string, target: string): CombatEvent => ({ type: 'rally', source, target } as CombatEvent);
  const attack = (attacker: string, defender: string): CombatEvent =>
    ({ type: 'attack', attacker, defender, swing: 0 } as CombatEvent);
  const SPARKLE = 'echohorn-target-sparkle';

  beforeEach(() => { mockPlayDef.mockClear(); mockAnchors.mockClear(); mockCanPlayDefs.mockReturnValue(true); });

  /** The sparkle waits for the attacker's yellow Rally pulse, which the lunge fires at the top of the
   *  wind-up. Derived from the LIVE wind-up rather than hardcoded, so retuning the lunge moves both. */
  const LEAD = (): number => rallyLeadMs(getLungeConfig().windupDur);

  // THE case. A real log, compiled the real way, so the absorption is exercised rather than assumed.
  it('plays the rallier CARD def at the ally it procced, inside the absorbed wind-up', () => {
    vi.useFakeTimers();
    const events = [attack('ech', 'foe'), rally('ech', 'ally'), { type: 'dmg', target: 'foe', amount: 3, remainingHp: 0 } as CombatEvent];
    const [windup] = compileMoments(events);
    expect(windup?.kind).toBe('attackExchange'); // the absorption itself — if this ever changes, so must the channel
    const c = baseCtx(events, withCard('ech', 'b2_echohorn'));
    runMomentCues(windup!, c);
    vi.advanceTimersByTime(LEAD());
    expect(mockAnchors).toHaveBeenCalledWith('ech', 'ally');
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    expect(mockPlayDef).toHaveBeenCalledWith(SPARKLE, { target: { x: 5, y: 7 } }, { uids: { source: 'ech', target: 'ally' }, index: 0 });
    vi.useRealTimers();
  });

  /**
   * THE SEQUENCING (owner call 2026-08-04): *"the rally token should pulse, then the target link goes off
   * after."* Both used to land together — the lunge pulses at the top of the wind-up and this cue fired at
   * the moment's start — so the beat read as one event instead of as cause and effect.
   */
  it('holds the sparkle until the attacker pulse has read', () => {
    vi.useFakeTimers();
    const events = [attack('ech', 'foe'), rally('ech', 'ally')];
    runMomentCues(compileMoments(events)[0]!, baseCtx(events, withCard('ech', 'b2_echohorn')));
    vi.advanceTimersByTime(LEAD() - 1);
    expect(mockPlayDef).not.toHaveBeenCalled();              // still inside the wind-up's Rally hold
    vi.advanceTimersByTime(2);
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  /** …but ONLY on an exchange, which is the only kind that has a wind-up to wait for. A standalone rally
   *  moment has no pulse to follow and must not sit doing nothing for half a second. */
  it('does not wait on a rally-kind moment, which has no wind-up', () => {
    vi.useFakeTimers();
    const events = [rally('ech', 'ally')];
    runMomentCues(moment('rally', events), baseCtx(events, withCard('ech', 'b2_echohorn')));
    expect(mockPlayDef).toHaveBeenCalledTimes(1);            // immediate, no lead
    vi.useRealTimers();
  });

  /** "Any instance of it triggering" — a gilded Echohorn loops twice, and both procs get their own play,
   *  spaced by the stack `beat` so the eye can count them. */
  it('fires once per PROC, spaced by the proc stride', () => {
    vi.useFakeTimers();
    const events = [attack('ech', 'foe'), rally('ech', 'ally'), rally('ech', 'ally')];
    const c = baseCtx(events, withCard('ech', 'b2_echohorn'));
    runMomentCues(compileMoments(events)[0]!, c);
    vi.advanceTimersByTime(LEAD());
    expect(mockPlayDef).toHaveBeenCalledTimes(1);           // the first lands after the pulse…
    vi.advanceTimersByTime(RALLY_PROC_STRIDE_MS - 1);
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    expect(mockPlayDef).toHaveBeenCalledTimes(2);           // …the second a beat later
    vi.useRealTimers();
  });

  /** Two ralliers in one exchange walk pair to pair on the wider `gap`, so "two different minions rallied"
   *  never reads as one minion rallying twice. */
  it('walks distinct pairs on the cascade gap, not the proc stride', () => {
    vi.useFakeTimers();
    const events = [attack('ech', 'foe'), rally('ech', 'ally1'), rally('ech2', 'ally2')];
    const c = baseCtx(events, { cardIds: new Map([['ech', 'b2_echohorn'], ['ech2', 'b2_echohorn']]) });
    runMomentCues(compileMoments(events)[0]!, c);
    vi.advanceTimersByTime(LEAD());
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RALLY_PROC_STRIDE_MS);           // a stride is NOT enough — these are separate pairs
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RALLY_GAP_MS - RALLY_PROC_STRIDE_MS);
    expect(mockPlayDef).toHaveBeenCalledTimes(2);
    expect(mockAnchors).toHaveBeenCalledWith('ech2', 'ally2');
    vi.useRealTimers();
  });

  /** The owner's scoping decision, in code: `kinds.rally` is a tombstone, so a rallier with no card binding
   *  plays NOTHING. Making the channel work must not switch on FX for every Rally in the game. */
  it('plays nothing for a rallier with no card binding', () => {
    const events = [attack('ds', 'foe'), rally('ds', 'ally')];
    runMomentCues(compileMoments(events)[0]!, baseCtx(events, withCard('ds', 'deathsayer')));
    expect(mockPlayDef).not.toHaveBeenCalled();
  });

  /** …and with no uid→card map at all (older saved replays / synthetic fixtures) it resolves the kind layer,
   *  which is the same tombstone. Silence, never a crash. */
  it('plays nothing when the moment carries no card map', () => {
    const events = [attack('ech', 'foe'), rally('ech', 'ally')];
    runMomentCues(compileMoments(events)[0]!, baseCtx(events));
    expect(mockPlayDef).not.toHaveBeenCalled();
  });

  /**
   * THE ONE-CHANNEL RULE. A moment that really is `rally`-kind (a synthetic fixture, or a saved replay from
   * before the absorption) must still play exactly ONCE: `fxDef` stands down there so the two channels cannot
   * both resolve the same binding and double the effect.
   */
  it('owns the rally kind outright — fxDef stands down, so nothing plays twice', () => {
    const events = [rally('ech', 'ally')];
    expect(momentKind(events[0]!)).toBe('rally');
    const c = baseCtx(events, withCard('ech', 'b2_echohorn'));
    runMomentCues(moment('rally', events), c);
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    expect(mockPlayDef).toHaveBeenCalledWith(SPARKLE, expect.anything(), { uids: { source: 'ech', target: 'ally' }, index: 0 });
  });

  /** Guarded before anything is allocated, exactly like `fxDef`/`rubyFx`: headless and pre-`ensureDefsReady`
   *  this path must cost two property reads and schedule no timer. */
  it('schedules nothing when defs cannot play', () => {
    mockCanPlayDefs.mockReturnValue(false);
    const events = [attack('ech', 'foe'), rally('ech', 'ally')];
    runMomentCues(compileMoments(events)[0]!, baseCtx(events, withCard('ech', 'b2_echohorn')));
    expect(mockPlayDef).not.toHaveBeenCalled();
    expect(mockAnchors).not.toHaveBeenCalled();
  });
});

/**
 * SUMMON DELIVERY — the cue hands over the units its sparkle is carrying.
 *
 * A Rally's summon commits to the frame the instant the moment becomes current, so without this the cub is
 * already on the board when the sparkle that procced it finally fires (owner report 2026-08-05, Echohorn
 * Rallying a Manasaber). `useCombatReplay` withholds them pre-paint; this cue is the release half.
 */
describe('rallyFx channel — summon delivery', () => {
  const rally = (source: string, target: string): CombatEvent => ({ type: 'rally', source, target } as CombatEvent);
  const attack = (attacker: string, defender: string): CombatEvent =>
    ({ type: 'attack', attacker, defender, swing: 0 } as CombatEvent);
  const summon = (uid: string): CombatEvent =>
    ({ type: 'summon', side: 'player', index: 0, minion: { uid, cardId: 'sabercub', name: 'Saber Cub', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false } } as CombatEvent);
  const LEAD = (): number => rallyLeadMs(getLungeConfig().windupDur);

  beforeEach(() => {
    mockPlayDef.mockClear(); mockAnchors.mockClear();
    mockCanPlayDefs.mockReturnValue(true);
    mockAnchors.mockReturnValue({ target: { x: 5, y: 7 } });
    releaseAllSummons();
  });
  afterEach(() => releaseAllSummons());

  /** What the layout effect withholds. Same resolver the cue releases from, so the two cannot disagree —
   *  a set the holder computed and the releaser didn't would strand a live minion off the board. */
  it('rallyDeliveredUids names exactly the units a BOUND rally will deliver', () => {
    const events = [attack('ech', 'foe'), rally('ech', 'saber'), summon('c1'), summon('c2')];
    const moment = compileMoments(events)[0]!;
    expect(rallyDeliveredUids(moment, { events, cardIds: new Map([['ech', 'b2_echohorn']]) })).toEqual(['c1', 'c2']);
  });

  /** An UNBOUND rallier plays no effect, so nothing would ever release its summons — they must never be
   *  held in the first place. This is the guard that keeps the tombstoned global `rally` row safe. */
  it('names nothing for an unbound rallier', () => {
    const events = [attack('ds', 'foe'), rally('ds', 'ally'), summon('c1')];
    const moment = compileMoments(events)[0]!;
    expect(rallyDeliveredUids(moment, { events, cardIds: new Map([['ds', 'deathsayer']]) })).toEqual([]);
  });

  /** …and likewise when defs can't play at all (headless, or before `ensureDefsReady`): the cue schedules
   *  nothing, so the holder must be told to hold nothing. The check lives in the shared resolver for exactly
   *  this reason — a caller that forgot it would hide a minion for the full TTL. */
  it('names nothing when defs cannot play', () => {
    mockCanPlayDefs.mockReturnValue(false);
    const events = [attack('ech', 'foe'), rally('ech', 'saber'), summon('c1')];
    const moment = compileMoments(events)[0]!;
    expect(rallyDeliveredUids(moment, { events, cardIds: new Map([['ech', 'b2_echohorn']]) })).toEqual([]);
  });

  it('releases the litter when its sparkle lands, not before', () => {
    vi.useFakeTimers();
    const events = [attack('ech', 'foe'), rally('ech', 'saber'), summon('c1'), summon('c2')];
    const c = baseCtx(events, withCard('ech', 'b2_echohorn'));
    holdSummon('c1'); holdSummon('c2');           // what the layout effect does, pre-paint
    runMomentCues(compileMoments(events)[0]!, c);
    vi.advanceTimersByTime(LEAD() - 1);
    expect(isSummonHeld('c1')).toBe(true);        // still withheld through the wind-up
    vi.advanceTimersByTime(2);
    expect(isSummonHeld('c1')).toBe(false);       // …delivered by the sparkle
    expect(isSummonHeld('c2')).toBe(false);
    vi.useRealTimers();
  });

  /** THE gilded case end to end: one litter per sparkle. Both arriving on the first land would leave the
   *  second detonation delivering nothing, which is the bug this whole attribution exists to avoid. */
  it('delivers one proc litter per sparkle, not all of them on the first', () => {
    vi.useFakeTimers();
    const events = [attack('ech', 'foe'), rally('ech', 'saber'), summon('c1'), rally('ech', 'saber'), summon('c2')];
    const c = baseCtx(events, withCard('ech', 'b2_echohorn'));
    holdSummon('c1'); holdSummon('c2');
    runMomentCues(compileMoments(events)[0]!, c);
    vi.advanceTimersByTime(LEAD());
    expect(isSummonHeld('c1')).toBe(false);       // first proc's cub is out…
    expect(isSummonHeld('c2')).toBe(true);        // …the second's is still held
    vi.advanceTimersByTime(RALLY_PROC_STRIDE_MS);
    expect(isSummonHeld('c2')).toBe(false);
    vi.useRealTimers();
  });

  /**
   * A hold is a PRESENTATION debt. If the effect cannot anchor (the ally died mid-cascade, the unit left the
   * screen) the def never plays — and leaving the summon withheld to time out would hide a live minion for
   * the sake of an effect that never happened. Release is unconditional.
   */
  it('still releases when the def cannot anchor', () => {
    vi.useFakeTimers();
    mockAnchors.mockReturnValue(null);
    const events = [attack('ech', 'foe'), rally('ech', 'saber'), summon('c1')];
    const c = baseCtx(events, withCard('ech', 'b2_echohorn'));
    holdSummon('c1');
    runMomentCues(compileMoments(events)[0]!, c);
    vi.advanceTimersByTime(LEAD());
    expect(mockPlayDef).not.toHaveBeenCalled();   // nothing played…
    expect(isSummonHeld('c1')).toBe(false);       // …and the cub is on the board anyway
    expect(anySummonHeld()).toBe(false);
    vi.useRealTimers();
  });
});

/**
 * ONE PULSE PER RALLY (owner call 2026-08-24, reversing the 2026-08-05 once-per-proc call): a gilded Echohorn
 * still RALLIES once — gilding doubles the EFFECT, not the trigger — so the medallion pulses a single time at
 * the opener. The doubling reads through the repeated SPARKLE + Echo effect, not a repeated pulse. The lunge
 * fires that one opener from its wind-up (a `once()`-wrapped point); this cue adds NO pulse for the attacker's
 * extra procs, and owns the single opener only for a lunge-less rally-KIND moment. (Across-moment split procs —
 * Echohorn's 2nd rally in its own beat — are suppressed one level up, in `useCombatReplay`'s held-attacker
 * wrapper; this cue only sees the within-moment case.)
 */
describe('rallyFx channel — one pulse per Rally', () => {
  const rally = (source: string, target: string): CombatEvent => ({ type: 'rally', source, target } as CombatEvent);
  const attack = (attacker: string, defender: string): CombatEvent =>
    ({ type: 'attack', attacker, defender, swing: 0 } as CombatEvent);
  const LEAD = (): number => rallyLeadMs(getLungeConfig().windupDur);

  beforeEach(() => {
    mockPlayDef.mockClear(); mockAnchors.mockClear();
    mockCanPlayDefs.mockReturnValue(true);
    mockAnchors.mockReturnValue({ target: { x: 5, y: 7 } });
    releaseAllSummons();
  });

  /** The lunge already flashed the attacker at the top of the wind-up. Firing it again here would double the
   *  opening pulse — the one case this cue must NOT cover. */
  it('leaves the first proc to the lunge, which already pulsed the attacker', () => {
    vi.useFakeTimers();
    const events = [attack('ech', 'foe'), rally('ech', 'ally')];
    const onRallyPulse = vi.fn();
    runMomentCues(compileMoments(events)[0]!, baseCtx(events, { ...withCard('ech', 'b2_echohorn'), onRallyPulse }));
    vi.advanceTimersByTime(LEAD() + 1000);
    expect(mockPlayDef).toHaveBeenCalledTimes(1);   // the sparkle played…
    expect(onRallyPulse).not.toHaveBeenCalled();    // …but the cue fired no pulse of its own
    vi.useRealTimers();
  });

  /** THE new ask: a gilded Echohorn procs twice but RALLIED once, so the cue adds NO second medallion pulse —
   *  the doubling shows in the two sparkles, not a second flash. */
  it('does NOT pulse again for the second proc — the doubling is in the sparkle', () => {
    vi.useFakeTimers();
    const events = [attack('ech', 'foe'), rally('ech', 'ally'), rally('ech', 'ally')];
    const onRallyPulse = vi.fn();
    runMomentCues(compileMoments(events)[0]!, baseCtx(events, { ...withCard('ech', 'b2_echohorn'), onRallyPulse }));
    vi.advanceTimersByTime(LEAD() + RALLY_PROC_STRIDE_MS + 1000);
    expect(onRallyPulse).not.toHaveBeenCalled();    // the attacker's only pulse was the lunge's opener
    expect(mockPlayDef).toHaveBeenCalledTimes(2);   // …but BOTH sparkles still fired, one per proc
    vi.useRealTimers();
  });

  /** The effect still doubles even though the pulse does not: the two sparkles cascade one PROC STRIDE apart. */
  it('still fires each proc its own sparkle, a stride apart, with no cue pulse', () => {
    vi.useFakeTimers();
    const events = [attack('ech', 'foe'), rally('ech', 'ally'), rally('ech', 'ally')];
    const onRallyPulse = vi.fn();
    runMomentCues(compileMoments(events)[0]!, baseCtx(events, { ...withCard('ech', 'b2_echohorn'), onRallyPulse }));
    vi.advanceTimersByTime(LEAD());
    expect(mockPlayDef).toHaveBeenCalledTimes(1);   // first sparkle at the lead…
    vi.advanceTimersByTime(RALLY_PROC_STRIDE_MS);
    expect(mockPlayDef).toHaveBeenCalledTimes(2);   // …the second a PROC STRIDE later
    expect(onRallyPulse).not.toHaveBeenCalled();    // and the attacker never got a cue pulse
    vi.useRealTimers();
  });

  /** A rally-KIND moment has no lunge, so nobody pulsed the opener — the cue owns that one too. */
  it('pulses the FIRST proc too when there is no wind-up to have done it', () => {
    const events = [rally('ech', 'ally')];
    const onRallyPulse = vi.fn();
    runMomentCues(moment('rally', events), baseCtx(events, { ...withCard('ech', 'b2_echohorn'), onRallyPulse }));
    expect(onRallyPulse).toHaveBeenCalledTimes(1);
    expect(onRallyPulse).toHaveBeenCalledWith('ech');
  });

  /** Optional on the context — the non-combat callers and every older test pass no medallion. */
  it('plays the sparkles fine with no pulse callback at all', () => {
    vi.useFakeTimers();
    const events = [attack('ech', 'foe'), rally('ech', 'ally'), rally('ech', 'ally')];
    expect(() => {
      runMomentCues(compileMoments(events)[0]!, baseCtx(events, withCard('ech', 'b2_echohorn')));
      vi.advanceTimersByTime(LEAD() + RALLY_PROC_STRIDE_MS + 10);
    }).not.toThrow();
    expect(mockPlayDef).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
