// @vitest-environment jsdom
/**
 * PASSARIA'S BUTTON (owner 2026-11-04, R-DUOS-PRIESTESS-01). The power's button reads the engine's own answer: live with a
 * teammate and something to pass, dark with neither, so a press never arms an aim with nowhere to land. It wears the
 * wired art and prints the 2 Gold.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createVersusRun, type BoardCard, type RunState } from '@game/sim';
import { heroArt, heroPowerArt } from './art';
import { StatusBar } from './StatusBar';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';

vi.mock('./fx/playDef', () => ({ playDef: vi.fn(), canPlayDefs: () => true }));

const minion = (uid: string, golden = false): BoardCard => ({ uid, cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden });
const seat = (over: Partial<RunState> = {}): RunState => ({
  ...createVersusRun(11, 'priestess', 'set2', { v: 1, mode: 'duos', modifiers: [] }), phase: 'recruit', embers: 10, board: [minion('m0')], shop: [], ...over,
} as RunState);

let ui: Mounted;
const show = (run: RunState): void => {
  act(() => { useGame.setState({ run, equipArmed: false, heroArmed: false }); });
  ui.render(<StatusBar />);
};
const btn = (): HTMLButtonElement => ui.container.querySelector<HTMLButtonElement>('.heropanel .heropowerbtn')!;

beforeEach(() => { ui = mount(<div />); });
afterEach(() => { ui.unmount(); });

describe('Passaria button', () => {
  it('is live on a Duos seat with a minion to pass, and prints 2 Gold', () => {
    show(seat());
    expect(btn().disabled).toBe(false);
    expect(btn().classList.contains('ready')).toBe(true);
    expect(ui.container.querySelector('.heropanel .hpcost .costn')?.textContent).toBe('2');
  });

  it('is dark with only Gilded minions, with no teammate, and without the Gold', () => {
    show(seat({ board: [minion('g0', true)] }));
    expect(btn().disabled).toBe(true);
    show(seat({ duos: undefined }));
    expect(btn().disabled).toBe(true);
    show(seat({ embers: 1 }));
    expect(btn().disabled).toBe(true);
  });

  it('has its wired art', () => {
    expect(heroArt('priestess')).toBeTruthy();
    expect(heroPowerArt('priestess')).toBeTruthy();
  });
});
