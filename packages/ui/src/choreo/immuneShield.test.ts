// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '@game/core';

vi.mock('../fx/playDef', () => ({ playDef: vi.fn(() => null) }));

import { playDef } from '../fx/playDef';
import { sfx } from '../sfx';
import type { Moment } from './compile';
import { runAttackExchangeCues } from './engine';
import { playLunge, SETTLE_CUE_FRACTION } from './channels/lunge';
import { getLungeConfig } from '../lungeConfig';
import { hasImmuneShield } from './channels/immuneShield';

/**
 * R-IMMUNE-SHIELD-01 (owner 2026-10-18): *"they should gain a blue/gold shield when they wind up to attack that
 * dissipates when they settle"*. The engine flags the swings the immunity covers (`attack.immune`, pinned in
 * `packages/sim/src/immuneAttackFlag.test.ts`); this pins the presentation half: the shield forms at the wind-up
 * ONLY on a flagged swing, deflects a counterblow at contact, and is gone by the settle.
 */

function unit(uid: string, atk = 0): HTMLElement {
  const u = document.createElement('div');
  u.className = 'unit';
  u.setAttribute('data-uid', uid);
  u.innerHTML = `<div class="card compact stdframe"><span class="badge atk">${atk}</span></div>`;
  document.body.appendChild(u);
  // jsdom lays nothing out: give the card a rect so the Pixi plays have somewhere to land.
  const card = u.querySelector('.card') as HTMLElement;
  card.getBoundingClientRect = () => ({ left: 0, top: 0, width: 120, height: 160, right: 120, bottom: 160, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return u;
}

const moment = (immune: boolean): Moment => ({
  start: 0, end: 1,
  primary: { type: 'attack', attacker: 'a', defender: 'b', swing: 5, ...(immune ? { immune: true } : {}) } as CombatEvent,
  stepGroups: [[0]], kind: 'attackExchange',
});
const ids = (): string[] => vi.mocked(playDef).mock.calls.map((c) => c[0]);

afterEach(() => { vi.restoreAllMocks(); vi.mocked(playDef).mockClear(); document.body.innerHTML = ''; });

describe('R-IMMUNE-SHIELD-01: the immune shield rides one swing', () => {
  it('a flagged swing: forms at the wind-up, holds through the strike, dissipates by the settle', () => {
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    const a = unit('a');
    const d = unit('b', 3);
    const tl = runAttackExchangeCues(moment(true), a, d, 0, -300, { combatSpeed: 1, advance: () => {}, immune: true })!;
    tl.time(0.01);
    expect(hasImmuneShield(a)).toBe(true);
    expect(ids()).toEqual(['immune-shield-form']);
    expect(a.querySelector('.card > .immshield.up')).not.toBeNull(); // mounted ON the card, so it rides the lunge
    tl.time(getLungeConfig().windupDur + 0.05); // mid-strike: still up, travelling with the card
    expect(hasImmuneShield(a)).toBe(true);
    tl.progress(1);
    expect(hasImmuneShield(a)).toBe(false);
    expect(ids()).toContain('immune-shield-deflect'); // the 3-Attack counterblow sparked off it
    expect(ids()[ids().length - 1]).toBe('immune-shield-dissipate');
  });

  it('an UNflagged swing (spent charges, or no immunity) shows no shield at all', () => {
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    const a = unit('a');
    const tl = runAttackExchangeCues(moment(false), a, unit('b', 3), 0, -300, { combatSpeed: 1, advance: () => {}, immune: false })!;
    tl.time(0.01);
    expect(hasImmuneShield(a)).toBe(false);
    tl.progress(1);
    expect(a.querySelector('.immshield')).toBeNull();
    expect(ids().some((id) => id.startsWith('immune-shield'))).toBe(false);
  });

  it('a defender with no Attack has no counterblow, so nothing deflects', () => {
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    const a = unit('a');
    const tl = runAttackExchangeCues(moment(true), a, unit('b', 0), 0, -300, { combatSpeed: 1, advance: () => {}, immune: true })!;
    tl.progress(1);
    expect(ids()).not.toContain('immune-shield-deflect');
    expect(ids().filter((id) => id.startsWith('immune-shield'))).toEqual(['immune-shield-form', 'immune-shield-dissipate']);
  });

  it('works for an ENEMY attacker swinging down the board the same way (symmetric)', () => {
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    const a = unit('e1');
    const tl = runAttackExchangeCues(moment(true), a, unit('p1', 2), 0, 300, { combatSpeed: 1, advance: () => {}, immune: true })!;
    tl.time(0.01);
    expect(hasImmuneShield(a)).toBe(true);
    tl.progress(1);
    expect(hasImmuneShield(a)).toBe(false);
  });
});

describe('playLunge: the wind-up-start and settle anchors', () => {
  it('onWindupStart fires first, onSettle after contact, inside the elastic settle', () => {
    const calls: string[] = [];
    const el = unit('x');
    const tl = playLunge({
      attacker: el, dx: 0, dy: -300, speed: 1, strike: { x: 0, y: -206 }, strikeDur: 0.16, leadTilt: 7, attackerRebound: 5,
      onContact: () => calls.push('contact'),
      onWindupStart: () => calls.push('windup'),
      onSettle: () => calls.push('settle'),
    });
    const settleAt = tl.duration() - getLungeConfig().settleDur * (1 - SETTLE_CUE_FRACTION);
    tl.time(0.01);
    expect(calls).toEqual(['windup']);
    tl.time(settleAt - 0.02);
    expect(calls).toEqual(['windup', 'contact']);
    tl.time(settleAt + 0.02);
    expect(calls).toEqual(['windup', 'contact', 'settle']);
    tl.progress(1);
    expect(calls).toEqual(['windup', 'contact', 'settle']); // once each
  });
});
