import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import { sfx } from '../sfx';
import { SCORE, runMomentCues } from './score';

const moment = (kind: Moment['kind'], events: CombatEvent[]): Moment => ({ start: 0, end: events.length, primary: events[0]!, stepGroups: [[0]], kind });
const baseCtx = (events: CombatEvent[], overrides: Partial<Parameters<typeof runMomentCues>[1]> = {}) => ({
  events, onShake: vi.fn(), findEl: () => null, attackerUid: null,
  onFloats: vi.fn(), onDeathFloats: vi.fn(),
  onAuraBurst: vi.fn(), onShieldBreak: vi.fn(), onReborn: vi.fn(), ...overrides,
});
const ctx = baseCtx;

afterEach(() => vi.restoreAllMocks());

describe('score', () => {
  it('every MomentKind has a cue list (exhaustive score)', () => {
    for (const cues of Object.values(SCORE)) expect(Array.isArray(cues)).toBe(true);
  });

  it('attackExchange scores lunge (start) + impact (contact) — no sfx/float double-firing the smack', () => {
    expect(SCORE.attackExchange).toEqual(expect.arrayContaining([{ ch: 'lunge', at: 'start' }, { ch: 'impact', at: 'contact' }]));
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

  it('the aura cue is on every kind via the shared default (grouped deaths are not missed)', () => {
    for (const kind of ['damage', 'death', 'reborn', 'shieldPop', 'poisonTick'] as const) {
      expect(SCORE[kind].some((c) => c.ch === 'aura')).toBe(true);
    }
  });

  it('runMomentCues bursts a REAL death anywhere in the moment (even a damage-kind moment containing a death)', () => {
    const onAuraBurst = vi.fn();
    const evs = [
      { type: 'dmg', target: 'b', amount: 9, remainingHp: 0 },
      { type: 'death', target: 'b', side: 'enemy' },
    ] as CombatEvent[];
    runMomentCues(moment('damage', evs), { ...baseCtx(evs), onAuraBurst });
    expect(onAuraBurst).toHaveBeenCalledWith('b');
  });

  it('a RISE death is NOT burst by the runner (the replay/engine own it)', () => {
    const onAuraBurst = vi.fn();
    const evs = [{ type: 'death', target: 'r', side: 'enemy', rise: true }] as CombatEvent[];
    runMomentCues(moment('riseDeath', evs), { ...baseCtx(evs), onAuraBurst });
    expect(onAuraBurst).not.toHaveBeenCalled();
  });

  it('runMomentCues routes a shield-consume to onShieldBreak and a reborn to onReborn', () => {
    const onShieldBreak = vi.fn();
    const onReborn = vi.fn();
    runMomentCues(moment('shieldPop', [{ type: 'shield', target: 's' }] as CombatEvent[]), { ...baseCtx([{ type: 'shield', target: 's' }] as CombatEvent[]), onShieldBreak });
    expect(onShieldBreak).toHaveBeenCalledWith('s');
    runMomentCues(moment('reborn', [{ type: 'reborn', target: 'x', hp: 1, attack: 2, keywords: [] }] as CombatEvent[]), { ...baseCtx([{ type: 'reborn', target: 'x', hp: 1, attack: 2, keywords: [] }] as CombatEvent[]), onReborn });
    expect(onReborn).toHaveBeenCalledWith('x');
  });
});
