import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import { sfx } from '../sfx';
import { runAttackExchangeCues, runRiseReturn } from './engine';

// Node env (no jsdom) — use a stubbed attacker Element (see lunge.test.ts). `defender` is null here, so the
// impact channel skips getBoundingClientRect; the attacker stub only needs the fields playLunge reads.
const fakeEl = (): Element => ({
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  classList: { contains: () => false },
  querySelector: () => null,
}) as unknown as Element;

const attackMoment = (swing: number): Moment => ({
  start: 0, end: 1,
  primary: { type: 'attack', attacker: 'a', defender: 'b', swing } as CombatEvent,
  stepGroups: [[0]], kind: 'attackExchange',
});
const nonAttackMoment: Moment = { start: 0, end: 1, primary: { type: 'dmg', target: 'b', amount: 1, remainingHp: 1 }, stepGroups: [[0]], kind: 'damage' };

afterEach(() => vi.restoreAllMocks());

describe('runAttackExchangeCues', () => {
  it('a non-attack moment is a no-op: no timeline, advance never called', () => {
    const advance = vi.fn();
    const tl = runAttackExchangeCues(nonAttackMoment, fakeEl(), null, 10, 0, { combatSpeed: 1, advance });
    expect(tl).toBeNull();
    expect(advance).not.toHaveBeenCalled();
  });

  it('an attack moment, seeked to completion: fires the hit sound and advance exactly once', () => {
    const hit = vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    const advance = vi.fn();
    const tl = runAttackExchangeCues(attackMoment(5), fakeEl(), null, 10, 0, { combatSpeed: 1, advance });
    expect(tl).not.toBeNull();
    tl!.progress(1);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(advance).toHaveBeenCalledTimes(1);
  });
});

describe('runRiseReturn', () => {
  it('pulls the risen attacker home, firing onLanded exactly once at the tween end', () => {
    const el = fakeEl();
    const onLanded = vi.fn();
    const tl = runRiseReturn(el, 1, onLanded);
    expect(onLanded).not.toHaveBeenCalled();
    tl.progress(1);
    expect(onLanded).toHaveBeenCalledTimes(1);
  });
});
