import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import { sfx } from '../sfx';
import { SCORE_DEFAULTS, getScore, getCues, setCue, resetScore, scoreJson, runMomentCues, type Channel } from './score';
import { momentKind, type MomentKind } from './kinds';
import { holdMsForKind } from './choreoConfig';
import { canPlayDefs, playDef } from '../fx/playDef';
import { anchorsForUnits } from '../fx/combatAnchors';

// The `fxDef` channel's collaborators are mocked at the CONTRACT (`playDef`/`canPlayDefs`/`anchorsForUnits`),
// so these tests prove the SCORE's dispatch/guard/timing wiring without depending on how the fx layer renders.
vi.mock('../fx/playDef', () => ({ playDef: vi.fn(() => () => {}), canPlayDefs: vi.fn(() => true) }));
vi.mock('../fx/combatAnchors', () => ({ anchorsForUnits: vi.fn(() => ({ target: { x: 5, y: 7 } })) }));
const mockPlayDef = vi.mocked(playDef);
const mockCanPlayDefs = vi.mocked(canPlayDefs);
const mockAnchors = vi.mocked(anchorsForUnits);

const moment = (kind: Moment['kind'], events: CombatEvent[]): Moment => ({ start: 0, end: events.length, primary: events[0]!, stepGroups: [[0]], kind });
const baseCtx = (events: CombatEvent[], overrides: Partial<Parameters<typeof runMomentCues>[1]> = {}) => ({
  events, combatSpeed: 1, onShake: vi.fn(), findEl: () => null, attackerUid: null, meleePair: null,
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
    expect(c.onFloats).toHaveBeenCalledWith([{ id: 0, uid: 'b', text: '4', kind: 'dmg' }]);
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
    runMomentCues(moment('poisonTick', c.events), c);
    expect(c.onExecuteFx).not.toHaveBeenCalled();
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
    { type: 'sc', source: 'a', text: 'x' }, { type: 'summon', side: 'player', index: 0, minion: { uid: 'z', cardId: 'alley', name: 'Alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false } },
    { type: 'buff', target: 'b', source: 'a', attack: 1, health: 1 },
    { type: 'reborn', target: 'b', attack: 1, hp: 1, keywords: [] },
    { type: 'ascend', target: 'b', into: 'taragosa' }, { type: 'rally', source: 'a', target: 'b' },
    { type: 'toHand', cardId: 'growth' }, { type: 'maxGold', target: 'b', amount: 1 },
    { type: 'improve', target: 'b', amount: 1 },
    { type: 'keyword', target: 'b', keyword: 'DS' }, { type: 'keywordLost', target: 'b', keyword: 'T' },
    { type: 'hpGrant', target: 'b', amount: 2 }, { type: 'spellProgress', target: 'b', amount: 3 },
    { type: 'reveal', target: 'b' },
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

describe('fxDef channel', () => {
  beforeEach(() => {
    // The suite-wide `restoreAllMocks` strips these module mocks' implementations — restate them per test.
    mockPlayDef.mockReset(); mockPlayDef.mockImplementation(() => () => {});
    mockCanPlayDefs.mockReset(); mockCanPlayDefs.mockImplementation(() => true);
    mockAnchors.mockReset(); mockAnchors.mockImplementation(() => ({ target: { x: 5, y: 7 } }));
    resetScore();
  });
  afterEach(() => resetScore());

  it('is scored on shieldGain ONLY, with the ward-gained def (exactly one binding)', () => {
    expect(SCORE_DEFAULTS.shieldGain).toEqual(expect.arrayContaining([
      { ch: 'fxDef', at: 'start', offset: 0, def: 'ward-gained' },
    ]));
    for (const [kind, cues] of Object.entries(SCORE_DEFAULTS)) {
      expect(cues.some((c) => c.ch === 'fxDef'), kind).toBe(kind === 'shieldGain');
    }
  });

  // The kinds split must not have cost the moment anything it already played.
  it('shieldGain keeps every cue shieldPop had — the split is purely additive', () => {
    const before = SCORE_DEFAULTS.shieldPop.map((c) => c.ch);
    expect(SCORE_DEFAULTS.shieldGain.map((c) => c.ch)).toEqual([...before, 'fxDef']);
    expect(holdMsForKind('shieldGain')).toBe(holdMsForKind('shieldPop')); // and the pacing is identical
  });

  it('dispatches the channel: plays the cue def with the resolved anchors', () => {
    const c = baseCtx([{ type: 'shieldUp', target: 'b' }] as CombatEvent[]);
    runMomentCues(shieldUpMoment(), c);
    // a shieldUp carries a target but no source → the missing side is passed as null
    expect(mockAnchors).toHaveBeenCalledWith(null, 'b');
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    expect(mockPlayDef).toHaveBeenCalledWith('ward-gained', { target: { x: 5, y: 7 } });
  });

  it('no-ops when canPlayDefs() is false (production: defs do not ship)', () => {
    mockCanPlayDefs.mockReturnValue(false);
    const c = baseCtx([{ type: 'shieldUp', target: 'b' }] as CombatEvent[]);
    runMomentCues(shieldUpMoment(), c);
    expect(mockPlayDef).not.toHaveBeenCalled();
    expect(mockAnchors).not.toHaveBeenCalled(); // bails BEFORE resolving anchors — costs nothing
  });

  it('no-ops when the cue carries no def id', () => {
    setCue('shieldGain', 'fxDef', { def: undefined });
    const c = baseCtx([{ type: 'shieldUp', target: 'b' }] as CombatEvent[]);
    runMomentCues(shieldUpMoment(), c);
    expect(mockPlayDef).not.toHaveBeenCalled();
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
    expect(mockPlayDef).toHaveBeenCalledWith('ward-gained', expect.anything());
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

  it('the new `def` field survives a JSON round-trip of the effective score', () => {
    resetScore();
    const json = JSON.parse(scoreJson());
    expect(json.shieldGain.find((c: { ch: string }) => c.ch === 'fxDef').def).toBe('ward-gained');
  });
});
