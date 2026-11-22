// @vitest-environment jsdom
/**
 * R-COMBAT-END-STATS-01 — ONCE A FIGHT IS OVER, ITS NUMBERS DO NOT MOVE (owner report 2026-11-21: "the number values
 * of minions are bouncing and rolling after combat ends").
 *
 * THE BUG. When the replay reports `done` it rebuilds the board without the dead (`beatStart` moves), which gave the
 * hold installer a new `frame` and re-ran it for the beat that had already played. The last beat's numbers were
 * withheld a SECOND time: the last hit's Health jumped back up and counted down again, and a last-beat buff dropped to
 * its old value until the 2 s safety net returned it.
 *
 * Pins, on the real replay hook with a fully faked clock:
 *  1. a fight whose last beat hits a survivor: nothing is held at `done`, and the hold store never moves after it;
 *  2. the same for a fight whose last beat BUFFS a survivor;
 *  3. End Combat (the hard stop) delivers every withheld number at once, and nothing moves after it;
 *  4. a number delivered by that settle lands with no badge pop, and the next real change pops as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { combatSide, makeRng, simulate, type CombatEvent, type CombatResult } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { mount, type Mounted } from './renderedText.mount';
import { useCombatReplay, type CombatReplay } from './useCombatReplay';
import { Card, type CardView } from './Card';
import { anyStatHeld, heldFor, holdStat, releaseAllStats, releaseStat, settleAllStats, subscribeStatHolds } from './fx/statHold';
import { hardStopCombat, releaseCombatHold } from './combatHardStop';

let ui: Mounted | null = null;
let replay: CombatReplay | null = null;
const findEl = (): Element | null => null; // stable identity, like Recruit's

function Harness({ combat, paused = false }: { combat: CombatResult; paused?: boolean }) {
  replay = useCombatReplay(combat, { active: true, findEl, combatSpeed: 1, paused });
  return null;
}

/** A body with no rules of its own, so a fixture's last beat is exactly the exchange it stages. */
const plain = Object.keys(CARD_INDEX).filter((k) => {
  const d = CARD_INDEX[k]!;
  return !d.spell && !d.token && d.keywords.length === 0 && (d.effects ?? []).length === 0;
});
const fight = (player: { cardId: string; attack: number; health: number }[], enemy: { cardId: string; attack: number; health: number }[]): CombatResult =>
  simulate(player, enemy, makeRng(7), CARD_INDEX, combatSide({ tier: 1 }), combatSide({ tier: 1 }));

/** The events of the fight's last swing (from its `attack` on). */
const lastSwing = (c: CombatResult): CombatEvent[] => {
  let i = c.events.length - 1;
  while (i > 0 && c.events[i]!.type !== 'attack') i--;
  return c.events.slice(i);
};

const step = (ms: number): void => { for (let t = 0; t < ms; t += 25) act(() => { vi.advanceTimersByTime(25); }); };
const playToDone = (): void => { let guard = 0; while (!replay!.done && guard++ < 4000) act(() => { vi.advanceTimersByTime(25); }); };
const noFx = { sfx: () => undefined, retireFx: () => 0, clearParticles: () => undefined };

describe('a finished fight keeps its numbers still (R-COMBAT-END-STATS-01)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  });
  afterEach(() => { ui?.unmount(); ui = null; replay = null; releaseAllStats(); releaseCombatHold(); vi.useRealTimers(); });

  /** Play `c` to `done`; report whether anything was held there and how often the hold store moved afterwards. */
  const afterDone = (c: CombatResult): { held: boolean; moves: number } => {
    ui = mount(<Harness combat={c} />);
    playToDone();
    expect(replay!.done).toBe(true);
    const held = anyStatHeld();
    let moves = 0;
    const off = subscribeStatHolds(() => { moves++; });
    step(4000);
    off();
    return { held, moves };
  };

  it('the last hit on a survivor is not counted down a second time', () => {
    expect(plain.length).toBeGreaterThan(1);
    const c = fight([{ cardId: plain[0]!, attack: 6, health: 9 }], [{ cardId: plain[1]!, attack: 4, health: 3 }]);
    // The fixture really ends on a blow its survivor took damage from.
    const swing = lastSwing(c);
    expect(swing.some((e) => e.type === 'dmg' && e.remainingHp > 0)).toBe(true);
    expect(swing.some((e) => e.type === 'death')).toBe(true);
    expect(afterDone(c)).toEqual({ held: false, moves: 0 });
  });

  it('a last-beat buff is not withheld again and returned later by the safety net', () => {
    // Chosen Fiend buffs itself when a friendly Demon deals damage, so its killing blow carries a buff on the survivor.
    const c = fight([{ cardId: 'dm_chosenfiend', attack: 6, health: 9 }], [{ cardId: plain[1]!, attack: 2, health: 3 }]);
    const swing = lastSwing(c);
    expect(swing.some((e) => e.type === 'buff' && (e.attack !== 0 || e.health !== 0))).toBe(true);
    expect(swing.some((e) => e.type === 'death')).toBe(true);
    expect(afterDone(c)).toEqual({ held: false, moves: 0 });
  });

  it('End Combat delivers every withheld number at once, and nothing moves after it', () => {
    const c = fight(
      [{ cardId: plain[0]!, attack: 3, health: 40 }, { cardId: plain[1]!, attack: 3, health: 40 }],
      [{ cardId: plain[2] ?? plain[0]!, attack: 3, health: 40 }, { cardId: plain[1]!, attack: 3, health: 40 }],
    );
    ui = mount(<Harness combat={c} />);
    // Run until a hit's count-down is in flight.
    let guard = 0;
    while (!anyStatHeld() && guard++ < 2000) act(() => { vi.advanceTimersByTime(25); });
    expect(anyStatHeld()).toBe(true);
    expect(replay!.done).toBe(false);
    // The press: the hard stop, and the replay's clock frozen (Recruit's `combatHalted`).
    act(() => { hardStopCombat(noFx); ui!.render(<Harness combat={c} paused />); });
    expect(anyStatHeld()).toBe(false);
    let moves = 0;
    const off = subscribeStatHolds(() => { moves++; });
    step(4000);
    off();
    expect(moves).toBe(0);
  });
});

describe('a settled number lands without a pop (R-COMBAT-END-STATS-01)', () => {
  interface Call { el: Element }
  const calls: Call[] = [];
  let frameCbs: FrameRequestCallback[] = [];
  const flushFrames = (): void => { const cbs = frameCbs; frameCbs = []; for (const cb of cbs) cb(0); };
  const origAnimate = (HTMLElement.prototype as { animate?: unknown }).animate;
  let m: Mounted | null = null;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frameCbs.push(cb); return frameCbs.length; });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = function animate(this: Element) {
      calls.push({ el: this });
      return { cancel: () => undefined, addEventListener: () => undefined };
    };
  });
  afterEach(() => {
    m?.unmount(); m = null; calls.length = 0; frameCbs = []; releaseAllStats();
    vi.unstubAllGlobals();
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = origAnimate;
  });

  const view = (attack: number, health: number): CardView => ({
    name: 'Test', cardId: 'ce3_seer', tribe: 'neutral', attack, health, keywords: [], text: '', tier: 1, baseAttack: 1, baseHealth: 1,
  } as CardView);
  const pops = (): number => calls.filter((c) => (c.el as HTMLElement).classList.contains('badge')).length;
  const shownHealth = (): string => m!.container.querySelector('.badge.hp')?.textContent ?? '';

  it('the settle prints the true number with no pop; the next real change pops as before', () => {
    m = mount(<Card uid="s1" card={view(3, 7)} autoRoll={false} />);
    act(() => { holdStat('s1', { health: 4 }); });
    act(() => { flushFrames(); });
    expect(shownHealth()).toContain('3');
    expect(heldFor('s1')).toEqual({ attack: 0, health: 4 });
    calls.length = 0;

    act(() => { settleAllStats(); });
    expect(heldFor('s1')).toBeNull();
    expect(shownHealth()).toContain('7');
    act(() => { flushFrames(); });
    expect(pops()).toBe(0);

    // The quiet lasts two frames, then the badge pops on a change like any other.
    act(() => { flushFrames(); });
    act(() => { flushFrames(); });
    act(() => { holdStat('s1', { health: 4 }); });
    act(() => { flushFrames(); });
    calls.length = 0;
    act(() => { releaseStat('s1'); });
    act(() => { flushFrames(); });
    expect(pops()).toBeGreaterThan(0);
  });
});
