import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import { sfx } from '../sfx';
import { SCORE_DEFAULTS, getScore, getCues, setCue, resetScore, scoreJson, runMomentCues } from './score';
import { momentKind } from './kinds';

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

  it('executeFx rides only the poisonTick kind — a plain death must not slash', () => {
    expect(SCORE_DEFAULTS.poisonTick.some((c) => c.ch === 'executeFx')).toBe(true);
    for (const kind of ['damage', 'death', 'shieldPop', 'attackExchange'] as const) {
      expect(SCORE_DEFAULTS[kind].some((c) => c.ch === 'executeFx'), kind).toBe(false);
    }
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
