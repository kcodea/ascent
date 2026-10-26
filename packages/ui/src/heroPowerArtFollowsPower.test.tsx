// @vitest-environment jsdom
/**
 * R-HERO-GRANT-RELEASE-01 (owner report 2026-10-26): "runemaster got a new hero power here but the art didnt change
 * to it. can you fix that". A Runesmith holding his forge rune (Shopkeep, the bell) gained Goldspring through Power
 * Shifter: the button kept the bell art AND the "Shopkeep" label, with only the cost coin (3) from the new power.
 * The button now reads its grant through `heroGrantOf`, so art, label and rule follow the CURRENT power, and the
 * rack (which leaves the hero-slot rune out) agrees.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRun, reduce, type RunState } from '@game/sim';
import { StatusBar } from './StatusBar';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';
import { heroPowerArt, runeArt } from './art';
import { heroSlotRuneId, rackRunes } from './heroSlotRune';

vi.mock('./fx/playDef', () => ({ playDef: vi.fn(), canPlayDefs: () => true }));

function runesmithWithShopkeep(): RunState {
  const s = {
    ...createRun(11, 'runesmith'), phase: 'recruit', wave: 5, embers: 50, maxEmbers: 50, board: [], hand: [],
    powerOffer: undefined, discover: undefined, questOffer: undefined, runeforgeOffer: ['rune_shopkeep'], runeforgeDiscounts: [0],
  } as RunState;
  return reduce(s, { type: 'buyRune', index: 0 } as never);
}
const shiftTo = (s: RunState, heroId: string): RunState =>
  reduce({ ...s, powerOffer: { heroIds: [heroId, 'warden'], slot: 'shifter' } } as RunState, { type: 'pickPower', index: 0 });

let ui: Mounted;
const show = (run: RunState): void => {
  act(() => { useGame.setState({ run, equipArmed: false, heroArmed: false }); });
  ui.render(<StatusBar />);
};
const panel = (): HTMLElement => ui.container.querySelector<HTMLElement>('.heropanel')!;
const artSrc = (): string | null => panel().querySelector('.hpb-art')?.getAttribute('src') ?? null;
const label = (): string | null => panel().querySelector('.hplabel')?.textContent ?? null;

beforeEach(() => { ui = mount(<div />); });
afterEach(() => { ui.unmount(); });

describe('R-HERO-GRANT-RELEASE-01: the hero-power button follows the current power', () => {
  it('the fixture art exists: the bell IS Rune of Shopkeep, and Goldspring has its own', () => {
    expect(runeArt('rune_shopkeep')).toBeTruthy();
    expect(heroPowerArt('nadja')).toBeTruthy();
  });

  it('before the swap the button wears the forge rune; after, the new power\'s art, name and cost', () => {
    const t5 = runesmithWithShopkeep();
    show(t5);
    expect(artSrc()).toBe(runeArt('rune_shopkeep'));
    expect(label()).toBe('Shopkeep');

    show(shiftTo(t5, 'nadja'));
    expect(artSrc(), 'the new power\'s art').toBe(heroPowerArt('nadja'));
    expect(label(), 'the new power\'s name').toBe('Goldspring');
    expect(panel().querySelector('.hpcost .costn')?.textContent).toBe('3');
    expect(panel().getAttribute('data-hero-rune') ?? panel().querySelector('[data-hero-rune]')?.getAttribute('data-hero-rune') ?? null).toBeNull();
  });

  it('a stale grant (a save from before the fix) still shows the new power', () => {
    const stale = { ...shiftTo(runesmithWithShopkeep(), 'nadja'), heroGrantArt: { kind: 'rune', id: 'rune_shopkeep' } } as RunState;
    show(stale);
    expect(artSrc()).toBe(heroPowerArt('nadja'));
    expect(label()).toBe('Goldspring');
    expect(heroSlotRuneId(stale)).toBeNull();
    expect(rackRunes(stale.ownedRunes ?? [], heroSlotRuneId(stale))).toEqual(stale.ownedRunes ?? []);
  });
});
