import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import { compileMoments } from './compile';
import { finalHoldMs, payloadReadMs, payloadRemainingMs } from './finalHold';
import { PAYLOAD_STACK_MS } from './channels/payloadFired';
import { getDef } from '../fx/fxDefs';
// Side-effect import (as `fx/defs.test.ts` does): the primitives self-register at load, and WITHOUT them
// `coerceLayer` drops every layer of every def (`getPrimitive` is empty), so `payloadReadMs` would fall back to
// the def's bare `duration` and the layer-span read below would be proven by nothing.
import '../fx/primitives';

/**
 * THE FINAL HOLD's payload floor (owner ask 2026-09-21: a crossing on the last attack must still play its
 * animation and beat in full). Pure — the hook has no renderHook harness — so the whole rule is proven here.
 */
const attack = (attacker: string, defender: string): CombatEvent => ({ type: 'attack', attacker, defender, swing: 0 } as CombatEvent);
const dmg = (target: string, source: string): CombatEvent => ({ type: 'dmg', target, source, amount: 6, remainingHp: 0 } as CombatEvent);
const trigger = (source: string): CombatEvent => ({ type: 'payloadTrigger', source, side: 'player', marker: 'dealtDamageGoldNextTurn' } as CombatEvent);
const death = (target: string): CombatEvent => ({ type: 'death', target, side: 'enemy' } as CombatEvent);
const cardIds = new Map([['gv', 'k3_goldvein'], ['hg', 'dw3_hangover']]);
const READ = 980;
const base = { finalHold: 900, pull: 0, readMs: () => READ };

describe('finalHoldMs', () => {
  it('without a crossing it is the hold it always was: finalHold ÷ speed, floored by a pull-home', () => {
    const ev = [attack('gv', 'foe'), dmg('foe', 'gv'), death('foe')];
    const last = compileMoments(ev).at(-1);
    expect(finalHoldMs(last, ev, cardIds, { ...base, combatSpeed: 1 })).toBe(900);
    expect(finalHoldMs(last, ev, cardIds, { ...base, combatSpeed: 4 })).toBe(225);
    expect(finalHoldMs(last, ev, cardIds, { ...base, combatSpeed: 4, pull: 550 })).toBe(650);
    expect(finalHoldMs(undefined, ev, cardIds, { ...base, combatSpeed: 4 })).toBe(225);
  });

  it('THE LAST-ATTACK CASE: a crossing in the last beat floors the hold at the def’s wall-clock read, whatever the speed', () => {
    const ev = [attack('gv', 'foe'), dmg('foe', 'gv'), death('foe'), trigger('gv')];
    const last = compileMoments(ev).at(-1);
    expect(finalHoldMs(last, ev, cardIds, { ...base, combatSpeed: 4 })).toBe(READ); // not 225
    expect(finalHoldMs(last, ev, cardIds, { ...base, combatSpeed: 1 })).toBe(READ); // not 900
    // A longer base hold still wins — the floor only ever lengthens.
    expect(finalHoldMs(last, ev, cardIds, { ...base, finalHold: 2000, combatSpeed: 1 })).toBe(2000);
  });

  it('a double crossing waits for the SECOND stacked detonation (one stride later, ÷ speed)', () => {
    const ev = [attack('hg', 'foe'), dmg('foe', 'hg'), trigger('hg'), trigger('hg'), death('foe')];
    const last = compileMoments(ev).at(-1);
    expect(finalHoldMs(last, ev, cardIds, { ...base, combatSpeed: 2 })).toBe(READ + PAYLOAD_STACK_MS / 2);
  });

  it('a body with nothing bound adds no floor (there is nothing on screen to wait for)', () => {
    const ev = [attack('gv', 'foe'), dmg('foe', 'gv'), death('foe'), trigger('gv')];
    const last = compileMoments(ev).at(-1);
    expect(finalHoldMs(last, ev, cardIds, { ...base, readMs: () => 0, combatSpeed: 4 })).toBe(225);
  });

  it('a flash fired on an EARLIER beat is waited out through pendingPayloadMs (Han Gover: the Ale + death beats trail the crossing)', () => {
    const ev = [attack('gv', 'foe'), dmg('foe', 'gv'), death('foe')]; // last beat: no crossing of its own
    const last = compileMoments(ev).at(-1);
    expect(finalHoldMs(last, ev, cardIds, { ...base, combatSpeed: 4, pendingPayloadMs: 600 })).toBe(600);
    expect(finalHoldMs(last, ev, cardIds, { ...base, combatSpeed: 4, pendingPayloadMs: 0 })).toBe(225);
  });
});

describe('payloadRemainingMs', () => {
  it('is what is left of the recorded flash at `now`, never negative, 0 with no fire', () => {
    expect(payloadRemainingMs(null, 5000)).toBe(0);
    expect(payloadRemainingMs({ at: 1000, readMs: 980 }, 1300)).toBe(680);
    expect(payloadRemainingMs({ at: 1000, readMs: 980 }, 1980)).toBe(0);
    expect(payloadRemainingMs({ at: 1000, readMs: 980 }, 9000)).toBe(0);
  });
});

describe('payloadReadMs — the real registry', () => {
  it('reads the owner’s payload-trigger PAST its 900ms duration — the burst (at 100, life 880) ends at 980 — and well under the 3s an unmodelled sound tail would add', () => {
    const def = getDef('payload-trigger')!;
    expect(def.layers.length).toBeGreaterThan(0); // the primitives ARE registered (else this test proves only `duration`)
    const read = payloadReadMs('k3_goldvein');
    expect(read).toBeGreaterThan(def.duration); // the layer-span path, not the duration floor
    expect(read).toBe(980);
    expect(read).toBeLessThan(2000);
    expect(payloadReadMs('dw3_hangover')).toBe(read);
  });

  it('resolves the kind-level binding for an unknown card too (no card layer shadows it)', () => {
    expect(payloadReadMs(null)).toBe(payloadReadMs('k3_goldvein'));
  });
});
