// @vitest-environment jsdom
/**
 * THE SHOP CLOCK LOCK ON THE BUTTONS (owner report 2026-09-30, R-TIMER-LOCK-01: "goldspring is usable after timer
 * ends. make sure hero powers cant be used after timer ends").
 *
 * The hero-power button, Void's second power and the Equipment slot read `shopLocked(run)` — the same predicate the
 * reducer refuses on — so the moment the clock's tick dispatches `shopClockExpired` they go dead: `disabled`, no
 * `.ready` glow, and a press dispatches nothing. Before 0:00 they are live as before.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRun, reduce, type BoardCard, type RunState } from '@game/sim';
import { StatusBar } from './StatusBar';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';

vi.mock('./fx/playDef', () => ({ playDef: vi.fn(), canPlayDefs: () => true }));

const minion = (uid: string, cardId: string, attack: number, health: number): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack, health, keywords: [], golden: false });

const nadja = (): RunState => ({ ...createRun(5, 'nadja'), phase: 'recruit', embers: 20, heroReady: true } as RunState);
const withBloodpot = (): RunState => ({
  ...createRun(21, 'warden'), phase: 'recruit', embers: 20,
  board: [minion('t', 'sandbag', 4, 4), minion('f', 'e3_frank', 3, 3)],
  equipment: {
    available: [{ equipmentId: 'bloodpot', version: 'plain', sourceUids: ['f'], grantedTurn: 1, ownChargeSpent: false }],
    bonusActivations: 0, bonusSpent: 0, temporaryCostReduction: 0,
    selectedEquipmentId: 'bloodpot', lastUsedEquipmentId: 'bloodpot',
  },
} as RunState);
const voidWith = (first: string, second: string): RunState => {
  let s: RunState = {
    ...createRun(11, 'voidhero'), phase: 'recruit', wave: 4, embers: 20, maxEmbers: 20, board: [], hand: [],
    powerOffer: { heroIds: [first, 'warden'], slot: 'void1' }, discover: undefined,
  } as RunState;
  s = reduce(s, { type: 'pickPower', index: 0 });
  s = { ...s, powerOffer: { heroIds: [second, 'warden'], slot: 'void2' } } as RunState;
  return reduce(s, { type: 'pickPower', index: 0 });
};
const expire = (s: RunState): RunState => reduce(s, { type: 'shopClockExpired' });

let ui: Mounted;
const show = (run: RunState): void => {
  act(() => { useGame.setState({ run, equipArmed: false, heroArmed: false }); });
  ui.render(<StatusBar />);
};
const powerBtns = (): HTMLButtonElement[] => [...ui.container.querySelectorAll<HTMLButtonElement>('.heropanel .heropowerbtn')];
const equipBtn = (): HTMLButtonElement | null => ui.container.querySelector<HTMLButtonElement>('.equipslot button.heropowerbtn');

beforeEach(() => { ui = mount(<div />); });
afterEach(() => { ui.unmount(); });

describe('hero power button', () => {
  it("Goldspring is live before 0:00: enabled, glowing", () => {
    show(nadja());
    const [btn] = powerBtns();
    expect(btn!.disabled).toBe(false);
    expect(btn!.classList.contains('ready')).toBe(true);
  });

  it('Goldspring goes dead at 0:00: disabled, no glow, and a press dispatches nothing', () => {
    const locked = expire(nadja());
    show(locked);
    const [btn] = powerBtns();
    expect(btn!.disabled).toBe(true);
    expect(btn!.classList.contains('ready')).toBe(false);
    act(() => { btn!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(useGame.getState().run.maxGoldBonus ?? 0).toBe(locked.maxGoldBonus ?? 0);
  });

  it("Void's second power goes dead too", () => {
    const s = voidWith('nadja', 'jenkins');
    show(s);
    expect(powerBtns()[1]!.disabled).toBe(false);
    show(expire(s));
    for (const b of powerBtns()) {
      expect(b.disabled).toBe(true);
      expect(b.classList.contains('ready')).toBe(false);
    }
  });
});

describe('Equipment slot', () => {
  it('Bloodpot is live before 0:00 and dead after it', () => {
    show(withBloodpot());
    expect(equipBtn(), 'the slot renders').not.toBeNull();
    expect(equipBtn()!.disabled).toBe(false);
    show(expire(withBloodpot()));
    expect(equipBtn()!.disabled).toBe(true);
    expect(equipBtn()!.classList.contains('ready')).toBe(false);
  });
});
