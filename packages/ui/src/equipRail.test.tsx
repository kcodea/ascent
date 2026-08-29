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


/**
 * THE ART SHEEN fires on a CHANGE OF PICTURE, not on an equip (owner ask 2026-08-29).
 *
 * *"this sheen should not play if the player already has equipment shown and they play another equip minion …
 * the first equip / going from 0→1 equipment, or when equipment is swapped in the slot."*
 *
 * Note this is a DIFFERENT question from the equip cue's gate. That one asks "did you acquire something?"
 * (`holdsEquipment`); this asks "did the slot's picture change?". They agree on a duplicate Frank — silent
 * either way — and they deliberately disagree elsewhere, which is why both exist.
 */
describe('the sheen plays only when the shown art changes', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const sheen = (): Element | null => ui.container.querySelector('.equipsheen');
  /** Let the scheduled fire land, then re-render. */
  const settle = (): void => {
    act(() => { vi.advanceTimersByTime(2000); });
    ui.render(<StatusBar />);
  };
  const oneEquipment = (id: 'bloodpot' | 'titan_hammer'): RunState => {
    const s = twoEquipment();
    s.equipment!.available = s.equipment!.available.filter((g) => g.equipmentId === id);
    s.equipment!.selectedEquipmentId = id;
    return s;
  };
  /**
   * Mount with an EMPTY slot, then show `run`.
   *
   * A fresh mount is not a change of picture, so it does not sweep — correct (StatusBar remounts on every
   * return from combat, and a sweep there would be a flourish nobody asked for), but it means a test that
   * mounts straight into a held Equipment observes nothing. Every case below therefore starts from empty and
   * transitions, which is also what actually happens in play.
   */
  const arrive = (run: RunState): void => {
    show({ ...twoEquipment(), equipment: undefined } as RunState);
    show(run);
  };

  it('sweeps on the FIRST Equipment — 0 → 1 is a new picture', () => {
    show({ ...twoEquipment(), equipment: undefined } as RunState);
    expect(sheen(), 'nothing shown, nothing to sweep').toBeNull();
    show(oneEquipment('bloodpot'));
    settle();
    expect(sheen(), 'the first Equipment shows new art').not.toBeNull();
  });

  it('sweeps when the rail SWAPS the slot to different art', () => {
    arrive(oneEquipment('bloodpot'));
    settle();
    expect(sheen(), 'the arrival itself swept').not.toBeNull();
    show(twoEquipment()); // still Bloodpot selected — no change of picture
    settle();
    const swapped = { ...twoEquipment() } as RunState;
    swapped.equipment = { ...swapped.equipment!, selectedEquipmentId: 'titan_hammer' };
    show(swapped);
    settle();
    expect(sheen(), 'the swap put different art in the slot').not.toBeNull();
  });

  it('does NOT sweep when a second copy of the SAME Equipment is played', () => {
    // The owner's case: Bloodpot already shown, another Alchemist Frank hits the board. Same picture.
    arrive(oneEquipment('bloodpot'));
    settle();
    // Compare the ELEMENT, not its class: a fresh sweep remounts the band under a new key, so identity is
    // what distinguishes "swept again" from "still the first one". (Comparing the class string passes either
    // way — this assertion was vacuous until that was noticed.)
    const marker = ui.container.querySelector('.equipsheen');
    expect(marker, 'the arrival swept').not.toBeNull();
    const secondFrank = oneEquipment('bloodpot');
    secondFrank.equipment!.available[0]!.sourceUids = ['f', 'f2']; // a second source, same Equipment
    show(secondFrank);
    settle();
    expect(ui.container.querySelector('.equipsheen'),
      'no new sweep — the slot is showing the same art it already was').toBe(marker);
  });

  it('does NOT sweep when the Equipment is merely re-held at Start of Turn', () => {
    arrive(oneEquipment('bloodpot'));
    settle();
    const marker = ui.container.querySelector('.equipsheen');
    expect(marker, 'the arrival swept').not.toBeNull();
    show({ ...oneEquipment('bloodpot'), wave: 2 } as RunState);
    settle();
    expect(ui.container.querySelector('.equipsheen'), 'the rebuild shows the same picture')
      .toBe(marker);
  });

  it('rides INSIDE the art wrapper, so it can never cross the frame png', () => {
    arrive(oneEquipment('bloodpot'));
    settle();
    // The owner was explicit: "it should play on the card art itself and not the equipment slot png". The
    // wrapper is the circular clip, so containment is structural rather than a value someone has to maintain.
    expect(ui.container.querySelector('.hpb-artwrap .equipsheen'), 'must be a child of the art clip')
      .not.toBeNull();
    expect(ui.container.querySelector('.equipframe .equipsheen'), 'and never of the frame').toBeNull();
  });
});
