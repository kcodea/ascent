// @vitest-environment jsdom
/**
 * THE HERO-POWER COST COIN ON ADOPTED POWERS (owner report 2026-09-15: a Void wielding Rounded Spellbook
 * showed no cost pill on either slot).
 *
 * The coin (`.hpcost`) prints `heroPowerCostOf` from @game/sim — the SAME helper the reducer charges — for
 * slot 0 AND Void's slot 1. What is asserted here is the readout contract, driven through the real store +
 * reducer (`pickPower` on a rigged offer is the real adoption path): a costed adopted power shows its live
 * coin in whichever slot holds it, the coin tracks the wave like the native hero's does, and a passive
 * (Empowering Vines) keeps the existing "· passive" badge with no coin — that is not a missing pill.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRun, reduce, type RunState } from '@game/sim';
import { StatusBar } from './StatusBar';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';

vi.mock('./fx/playDef', () => ({ playDef: vi.fn(), canPlayDefs: () => true }));

/** A Void run at `wave` that has just adopted `first` (slot 0) and `second` (slot 1) through `pickPower`. */
function voidWith(first: string, second: string, wave = 4): RunState {
  let s: RunState = {
    ...createRun(11, 'voidhero'), phase: 'recruit', wave, embers: 20, maxEmbers: 20, board: [], hand: [],
    powerOffer: { heroIds: [first, 'warden'], slot: 'void1' }, discover: undefined,
  } as RunState;
  s = reduce(s, { type: 'pickPower', index: 0 });
  s = { ...s, powerOffer: { heroIds: [second, 'warden'], slot: 'void2' } } as RunState;
  return reduce(s, { type: 'pickPower', index: 0 });
}

let ui: Mounted;
const show = (run: RunState): void => {
  act(() => { useGame.setState({ run, equipArmed: false, heroArmed: false }); });
  ui.render(<StatusBar />);
};
const panels = (): HTMLElement[] => [...ui.container.querySelectorAll<HTMLElement>('.heropanel')];
const coinOf = (panel: HTMLElement): string | null => panel.querySelector('.hpcost .costn')?.textContent ?? null;

beforeEach(() => { ui = mount(<div />); });
afterEach(() => { ui.unmount(); });

describe('the cost coin on adopted hero powers', () => {
  it('Void: Rounded Spellbook (slot 0) prints 3 on the pick turn; Empowering Vines (slot 1) is a passive, no coin', () => {
    show(voidWith('hunch', 'rayse', 4));
    const [p0, p1] = panels();
    expect(p0 && p1, 'both slots render').toBeTruthy();
    expect(coinOf(p0!), 'slot 0: the coin is back, at the full 3').toBe('3');
    expect(p1!.classList.contains('passive'), 'slot 1 is a passive').toBe(true);
    expect(p1!.textContent, 'the existing passive badge is the answer for a passive').toContain('passive');
    expect(coinOf(p1!), 'a passive has no price to print').toBeNull();
  });

  it('the coin tracks the wave from the PICK turn, exactly as the native hero from wave 1', () => {
    const s = voidWith('hunch', 'rayse', 4);
    show({ ...s, wave: 5 });
    expect(coinOf(panels()[0]!), 'wave N+1 → 2').toBe('2');
    show({ ...s, wave: 6 });
    expect(coinOf(panels()[0]!), 'wave N+2 → 1').toBe('1');
    show({ ...createRun(3, 'hunch'), phase: 'recruit', wave: 1, embers: 20 } as RunState);
    expect(coinOf(panels()[0]!), 'native Hunch, wave 1').toBe('3');
  });

  it('slot 1 renders the coin for a costed adopted power too (Dragon Tamer → 5)', () => {
    show(voidWith('rayse', 'tiff', 4));
    const [p0, p1] = panels();
    expect(coinOf(p0!), 'slot 0 passive').toBeNull();
    expect(coinOf(p1!), 'slot 1 costed').toBe('5');
  });

  it('a free power keeps the existing convention — no coin at 0 (a fresh Dynamite Dig)', () => {
    show(voidWith('jenkins', 'rayse', 4));
    expect(coinOf(panels()[0]!), 'the first dig is free: no coin, as native Jenkins shows').toBeNull();
  });
});
