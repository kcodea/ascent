// @vitest-environment jsdom
/**
 * THE EQUIPMENT SELECTOR RAIL (owner ask 2026-08-28: "when i mouse over the equipment, can it show the
 * available equipment options slide out to the right? then i can click on an option to select it as the
 * current equipment").
 *
 * The reveal itself is CSS (`.equipslot:hover .equiprail`) and jsdom does not do `:hover`, so what is asserted
 * here is everything the CSS cannot cover on its own — and everything that would silently rot:
 *
 *   1. the rail RENDERS one row per held Equipment, naming each and printing its live cost;
 *   2. clicking a row dispatches `selectEquipment` and the slot follows to that Equipment;
 *   3. it stays absent when there is nothing to choose between — a picker that can only do nothing;
 *   4. it is absent while ARMED, because a rail hanging off the slot would sit under the cursor on the way
 *      out to the board and eat the pick;
 *   5. the rail's buttons are NOT `.heropowerbtn`, which is what the aim-line anchor in Recruit.tsx queries.
 *
 * Driven through the real store + reducer rather than a stubbed prop, so a change to how the slot reads
 * `run.equipment` fails here rather than passing against a fixture.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRun, type BoardCard, type RunState } from '@game/sim';
import { StatusBar } from './StatusBar';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';

/** jsdom has no `PointerEvent`; React's onPointerDown listens for the event TYPE, so a MouseEvent does. */
const pointerDown = (el: HTMLElement): void => {
  act(() => { el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
};

const minion = (uid: string, cardId: string, attack: number, health: number): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack, health, keywords: [], golden: false });

/** A recruit-phase run holding BOTH Equipment, with Gold enough for either. */
function twoEquipment(over: Partial<RunState> = {}): RunState {
  const base = createRun(21, 'warden');
  return {
    ...base,
    phase: 'recruit',
    embers: 20,
    board: [minion('t', 'sandbag', 4, 4), minion('f', 'e3_frank', 3, 3), minion('s', 'e3_sculptor', 10, 8)],
    equipment: {
      available: [
        { equipmentId: 'bloodpot', version: 'plain', sourceUids: ['f'], grantedTurn: 1 },
        { equipmentId: 'titan_hammer', version: 'plain', sourceUids: ['s'], grantedTurn: 1 },
      ],
      baseActivations: 1, bonusActivations: 0, activationsSpent: 0,
      temporaryCostReduction: 0,
      selectedEquipmentId: 'bloodpot', lastUsedEquipmentId: 'bloodpot',
    },
    ...over,
  } as RunState;
}

let ui: Mounted;
const show = (run: RunState, extra: Record<string, unknown> = {}): void => {
  act(() => { useGame.setState({ run, equipArmed: false, heroArmed: false, ...extra }); });
  ui.render(<StatusBar />);
};
const rail = (): HTMLElement | null => ui.container.querySelector('.equiprail');
const rows = (): HTMLButtonElement[] => [...ui.container.querySelectorAll<HTMLButtonElement>('.equiprailbtn')];
const slotLabel = (): string => ui.container.querySelector('.equipslot .hplabel')?.textContent?.trim() ?? '';

beforeEach(() => { ui = mount(<div />); });
afterEach(() => { ui.unmount(); });

describe('the Equipment rail', () => {
  it('lists every held Equipment, named, with its live cost', () => {
    show(twoEquipment());
    expect(rail(), 'a player holding two Equipment gets a rail').not.toBeNull();
    expect(rows().map((b) => b.querySelector('.equiprail-name')?.textContent))
      .toEqual(['Bloodpot', 'Titan Hammer']);
    expect(rows().map((b) => b.querySelector('.equiprail-cost')?.textContent), 'the printed costs')
      .toEqual(['1', '3']);
  });

  it('marks the CURRENT pick, and only that one', () => {
    show(twoEquipment());
    expect(rows().map((b) => b.classList.contains('on'))).toEqual([true, false]);
    expect(rows().map((b) => b.getAttribute('aria-pressed')), 'and says so to a screen reader')
      .toEqual(['true', 'false']);
  });

  it('clicking a row makes it the current Equipment', () => {
    show(twoEquipment());
    expect(slotLabel()).toBe('Bloodpot');
    pointerDown(rows()[1]!);
    ui.render(<StatusBar />);
    expect(useGame.getState().run.equipment?.selectedEquipmentId, 'the reducer moved').toBe('titan_hammer');
    expect(slotLabel(), 'and the slot followed').toBe('Titan Hammer');
    expect(rows().map((b) => b.classList.contains('on')), 'the mark moved with it').toEqual([false, true]);
  });

  it('swapping spends no Gold and no use — it is free by contract', () => {
    show(twoEquipment());
    pointerDown(rows()[1]!);
    const after = useGame.getState().run;
    expect(after.embers, 'no Gold').toBe(20);
    expect(after.equipment?.activationsSpent, 'no use').toBe(0);
  });

  it('there is no rail with only one Equipment — a control that could only do nothing', () => {
    const one = twoEquipment();
    one.equipment!.available = [one.equipment!.available[0]!];
    show(one);
    expect(ui.container.querySelector('.equipslot'), 'the slot itself still shows').not.toBeNull();
    expect(rail()).toBeNull();
  });

  it('there is no rail while ARMED — it would sit under the cursor on the way to the board', () => {
    show(twoEquipment(), { equipArmed: true });
    expect(rail()).toBeNull();
  });

  it('its buttons are not `.heropowerbtn` — that selector anchors the aim line', () => {
    show(twoEquipment());
    expect(ui.container.querySelectorAll('.equiprail .heropowerbtn')).toHaveLength(0);
  });
});


/**
 * THE ARRIVE / LEAVE FADE (owner ask 2026-08-28: "add a brief fade in/fade out for the equipment so it
 * doesn't simply disappear immediately").
 *
 * The fade itself is a CSS animation jsdom will not run. What is asserted here is the part that is real
 * logic, and the part that would rot silently: the slot must STAY MOUNTED after the run stops having an
 * Equipment, painting a snapshot, and then actually go away. A leaving copy that never unmounted would look
 * completely correct in a screenshot.
 */
describe('the slot fades out instead of vanishing', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const gone = (run: RunState): RunState => ({ ...run, equipment: undefined, board: [] } as RunState);

  it('keeps painting the last Equipment after it is lost, then drops it', () => {
    const held = twoEquipment();
    show(held);
    expect(ui.container.querySelector('.equipslot.entering'), 'it arrives with the enter class').not.toBeNull();

    show(gone(held));
    const leaving = ui.container.querySelector('.equipslot.leaving');
    expect(leaving, 'the slot is still on screen, on its way out').not.toBeNull();
    expect(leaving!.querySelector('.hplabel')?.textContent, 'painting the Equipment that was lost')
      .toBe('Bloodpot');

    act(() => { vi.advanceTimersByTime(1000); });
    ui.render(<StatusBar />);
    expect(ui.container.querySelector('.equipslot'), 'and then it is gone for good').toBeNull();
  });

  it('the leaving copy is INERT — it is a picture of something you no longer have', () => {
    const held = twoEquipment();
    show(held);
    show(gone(held));
    const leaving = ui.container.querySelector('.equipslot.leaving')!;
    expect(leaving.getAttribute('aria-hidden'), 'and hidden from a screen reader').toBe('true');
    expect(leaving.querySelector('.equiprail'), 'no selector to open').toBeNull();
    expect(leaving.querySelector<HTMLButtonElement>('.heropowerbtn')!.disabled, 'and nothing to press')
      .toBe(true);
  });

  it('re-equipping mid-fade cancels the leave rather than stacking a second slot', () => {
    const held = twoEquipment();
    show(held);
    show(gone(held));
    expect(ui.container.querySelectorAll('.equipslot')).toHaveLength(1);
    show(held); // it came back before the timer ran out
    expect(ui.container.querySelectorAll('.equipslot'), 'ONE slot, not a live one beside a ghost')
      .toHaveLength(1);
    expect(ui.container.querySelector('.equipslot.leaving')).toBeNull();
    act(() => { vi.advanceTimersByTime(1000); });
    ui.render(<StatusBar />);
    expect(ui.container.querySelector('.equipslot'), 'and the stale timer does not remove the live one')
      .not.toBeNull();
  });
});
