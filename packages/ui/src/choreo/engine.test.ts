import { afterEach, describe, expect, it, vi } from 'vitest';
import gsap from 'gsap';
import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import { sfx } from '../sfx';
import { SCORE_DEFAULTS } from './score';
import { runAttackExchangeCues, runRiseReturn } from './engine';

// Node env (no jsdom) — use a stubbed attacker Element (see lunge.test.ts). `defender` is null here, so the
// impact channel skips getBoundingClientRect; the attacker stub only needs the fields playLunge reads.
const fakeEl = (): Element => ({
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 100 }),
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

  it('applies the impact cue offset to the contact fire position (fire-once preserved)', () => {
    const sc = SCORE_DEFAULTS.attackExchange.find((c) => c.ch === 'impact')!;
    const prev = sc.offset; sc.offset = 40; // mutate the in-memory default for this test
    try {
      const hit = vi.spyOn(sfx, 'hit').mockImplementation(() => {});
      const advance = vi.fn();
      const tl = runAttackExchangeCues(attackMoment(5), fakeEl(), null, 10, 0, { combatSpeed: 1, advance });
      tl!.progress(1);
      // A positive offset defers the smack via gsap.delayedCall (a global-timeline tween), so seeking the
      // returned lunge timeline advances `advance` (fired AT contact) but not the delayed impact — flush the
      // global timeline to fire the pending smack, then assert the fire-once contract holds for both.
      gsap.globalTimeline.progress(1);
      expect(hit).toHaveBeenCalledTimes(1);
      expect(advance).toHaveBeenCalledTimes(1);
    } finally { sc.offset = prev; }
  });

  it('scales the timeline duration with attack distance (far strike takes longer)', () => {
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    const near = runAttackExchangeCues(attackMoment(5), fakeEl(), null, 0, 200, { combatSpeed: 1, advance: vi.fn() });
    const far = runAttackExchangeCues(attackMoment(5), fakeEl(), null, 0, 3000, { combatSpeed: 1, advance: vi.fn() });
    expect(far!.duration()).toBeGreaterThan(near!.duration());
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
