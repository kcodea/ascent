// @vitest-environment jsdom
/**
 * THE EQUIPMENT COST COIN AT 0 (owner report 2026-09-18: Bloodpot at a 0 cost showed NO number at all — the coin
 * vanished, which read as a missing price rather than a free press).
 *
 * The slot's coin (`.equipslot .hpcost`) prints `equipmentCostOf` from @game/sim — the helper the reducer charges —
 * and it ALWAYS renders:
 *   1. the printed cost shows plain (gold coin, "1" for Bloodpot);
 *   2. a cost DISCOUNTED below the definition's `baseCost` (Quick Release armed, Efficient Tooling, …) shows the
 *      live number on the GREEN `.discounted` coin — the same cue the Rune pivot and the offer price use;
 *   3. a plain 0 (the Star Destroyer's base cost) prints "0" on the ordinary gold coin — free, not discounted.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRun, type BoardCard, type RunState } from '@game/sim';
import { StatusBar } from './StatusBar';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';

vi.mock('./fx/playDef', () => ({ playDef: vi.fn(), canPlayDefs: () => true }));

const minion = (uid: string, cardId: string, attack: number, health: number): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack, health, keywords: [], golden: false });

/** A recruit-phase run holding Bloodpot (Frank's, base cost 1). */
function withBloodpot(over: Partial<RunState> = {}): RunState {
  const base = createRun(21, 'warden');
  return {
    ...base,
    phase: 'recruit',
    embers: 20,
    board: [minion('t', 'sandbag', 4, 4), minion('f', 'e3_frank', 3, 3)],
    equipment: {
      available: [{ equipmentId: 'bloodpot', version: 'plain', sourceUids: ['f'], grantedTurn: 1, ownChargeSpent: false }],
      bonusActivations: 0, bonusSpent: 0,
      temporaryCostReduction: 0,
      selectedEquipmentId: 'bloodpot', lastUsedEquipmentId: 'bloodpot',
    },
    ...over,
  } as RunState;
}

let ui: Mounted;
const show = (run: RunState): void => {
  act(() => { useGame.setState({ run, equipArmed: false, heroArmed: false }); });
  ui.render(<StatusBar />);
};
const coin = (): HTMLElement | null => ui.container.querySelector<HTMLElement>('.equipslot .hpcost');

beforeEach(() => { ui = mount(<div />); });
afterEach(() => { ui.unmount(); });

describe('the Equipment cost coin', () => {
  it('prints the printed cost on the gold coin (Bloodpot: 1)', () => {
    show(withBloodpot());
    expect(coin(), 'the coin renders').not.toBeNull();
    expect(coin()!.textContent).toBe('1');
    expect(coin()!.classList.contains('discounted')).toBe(false);
  });

  it('a discount below the printed cost shows the live number on the GREEN coin (Quick Release armed → 0)', () => {
    show(withBloodpot({ quickReleaseArmed: true }));
    expect(coin(), 'the coin still renders at 0').not.toBeNull();
    expect(coin()!.textContent).toBe('0');
    expect(coin()!.classList.contains('discounted')).toBe(true);
  });

  it('Efficient Tooling on the first activation: a T3 Titan Hammer prints 1 in green', () => {
    show(withBloodpot({
      runeEfficientTooling: 2,
      equipment: {
        available: [{ equipmentId: 'titan_hammer', version: 'plain', sourceUids: ['t'], grantedTurn: 1, ownChargeSpent: false }],
        bonusActivations: 0, bonusSpent: 0, temporaryCostReduction: 0,
        selectedEquipmentId: 'titan_hammer', lastUsedEquipmentId: 'titan_hammer',
      },
    } as Partial<RunState>));
    expect(coin()!.textContent).toBe('1');
    expect(coin()!.classList.contains('discounted')).toBe(true);
  });

  it('a plain 0 base cost (Star Destroyer) prints "0" on the ordinary gold coin — free, not discounted', () => {
    show(withBloodpot({
      equipment: {
        available: [{ equipmentId: 'star_destroyer', version: 'plain', sourceUids: ['t'], grantedTurn: 1, ownChargeSpent: false }],
        bonusActivations: 0, bonusSpent: 0, temporaryCostReduction: 0,
        selectedEquipmentId: 'star_destroyer', lastUsedEquipmentId: 'star_destroyer',
      },
    } as Partial<RunState>));
    expect(coin(), 'the coin renders').not.toBeNull();
    expect(coin()!.textContent).toBe('0');
    expect(coin()!.classList.contains('discounted')).toBe(false);
  });
});
