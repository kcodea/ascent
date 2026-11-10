// @vitest-environment jsdom
/**
 * THE ARMED CALL ON THE HERO POWER BUTTON (owner 2026-11-10: "perfect, add it to those too" for Re-Pete, Gorr, Juggler,
 * Pete, Ayse and Drakko; "add it to quillen when his is at 2/3 too").
 *
 * The rule ("your next action, or the end of this turn, fires this power") is proven against the real reducer in
 * `packages/sim/src/powerArmed.test.ts`. This file proves the SCREEN: the passive power's panel and button wear the
 * existing `ready` classes exactly while it is armed in the Shop, drop them the moment the count moves on, never show
 * them in combat, keep the counter each hero already had, and survive a save and restore. Quillen, whose button already
 * wears `ready` whenever it can be pressed, turns its counter pill gold (`payout`) instead.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { CARD_INDEX } from '@game/content';
import { createRun, deserialize, serialize, type BoardCard, type RunState } from '@game/sim';
import { activePowerPayout, passivePowerReady } from './powerArmedUi';
import { StatusBar } from './StatusBar';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';

vi.mock('./fx/playDef', () => ({ playDef: vi.fn(), canPlayDefs: () => true }));

const PLAIN = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && c.tier === 1 && c.effects.length === 0)!;
const held: BoardCard = { uid: 'h0', cardId: PLAIN.id, tribe: PLAIN.tribe, attack: PLAIN.attack, health: PLAIN.health, keywords: [], golden: false };
const run = (heroId: string, over: Partial<RunState> = {}): RunState => ({
  ...createRun(9, heroId), phase: 'recruit', embers: 10, hand: [], board: [], shop: [], spell: null,
  powerOffer: undefined, discover: undefined, questOffer: undefined, pendingPowerOffer: undefined, ...over,
} as RunState);

/** Per hero: the state one step short of armed, the armed state, the state just after the fire, and the counter text. */
const CASES: { hero: string; before: Partial<RunState>; armed: Partial<RunState>; fired: Partial<RunState>; pills: [string, string, string] }[] = [
  { hero: 'repete', before: { wave: 2, hand: [held] }, armed: { wave: 3, hand: [held] }, fired: { wave: 4, hand: [held, { ...held, uid: 'h1' }] }, pills: ['1t', 'now', '2t'] },
  { hero: 'gorr', before: { gorrBuys: ['a'] }, armed: { gorrBuys: ['a', 'b'] }, fired: { gorrBuys: ['a', 'b', 'c'] }, pills: ['1/3', '2/3', '3/3'] },
  { hero: 'juggler', before: { jugglerBuys: 1 }, armed: { jugglerBuys: 2 }, fired: { jugglerBuys: 0 }, pills: ['1/3', '2/3', '0/3'] },
  { hero: 'pete', before: { refreshCount: 1 }, armed: { refreshCount: 2 }, fired: { refreshCount: 3 }, pills: ['1/3', '2/3', '0/3'] },
  { hero: 'cia', before: { ciaEnchantedBought: 1 }, armed: { ciaEnchantedBought: 2 }, fired: { ciaEnchantedBought: 0 }, pills: ['1/3', '2/3', '0/3'] },
  { hero: 'drakko', before: { drakkoBuys: 3 }, armed: { drakkoBuys: 4 }, fired: { drakkoBuys: 5, heroPowerSpent: true }, pills: ['3/5', '4/5', ''] },
];

describe('the view model', () => {
  it.each(CASES)('$hero: ready exactly while armed, in the Shop only', ({ hero, before, armed, fired }) => {
    expect(passivePowerReady(run(hero))).toBe(false);
    expect(passivePowerReady(run(hero, before))).toBe(false);
    expect(passivePowerReady(run(hero, armed))).toBe(true);
    expect(passivePowerReady(run(hero, fired))).toBe(false);
    expect(passivePowerReady(run(hero, { ...armed, phase: 'combat' })), 'no stale glow in combat').toBe(false);
  });

  it.each(CASES)('$hero: still armed after a save and restore', ({ hero, armed }) => {
    expect(passivePowerReady(deserialize(serialize(run(hero, armed))))).toBe(true);
  });

  it('Mimic wearing one of them is armed on the adopted power', () => {
    expect(passivePowerReady(run('mimic', { adoptedPowerId: 'juggler', jugglerBuys: 2 }))).toBe(true);
    expect(passivePowerReady(run('mimic', { jugglerBuys: 2 }))).toBe(false);
  });

  it('Quillen: the payout mark needs the power armed AND pressable; it is never the passive glow', () => {
    const two = run('quillen', { archivedTribes: ['beast', 'dragon'] });
    expect(passivePowerReady(two)).toBe(false);
    expect(activePowerPayout(two, 0, true)).toBe(true);
    expect(activePowerPayout(two, 0, false), 'used this turn: not pressable').toBe(false);
    expect(activePowerPayout(run('quillen', { archivedTribes: ['beast'] }), 0, true)).toBe(false);
    expect(activePowerPayout({ ...two, phase: 'combat' }, 0, true)).toBe(false);
    expect(activePowerPayout(run('juggler', { jugglerBuys: 2 }), 0, true), 'a passive never takes the payout mark').toBe(false);
  });
});

describe('the button', () => {
  let ui: Mounted;
  const show = (r: RunState): void => {
    act(() => { useGame.setState({ run: r, equipArmed: false, heroArmed: false }); });
    ui.render(<StatusBar />);
  };
  const panel = (): HTMLElement => ui.container.querySelector<HTMLElement>('.heropanel:not(.heropanel2):not(.equipslot)')!;
  const btn = (): HTMLButtonElement => panel().querySelector<HTMLButtonElement>('.heropowerbtn')!;
  const pillEl = (): HTMLElement | null => panel().querySelector<HTMLElement>('.hpb-tally.hpb-pill');
  const pill = (): string => pillEl()?.textContent ?? '';
  const glowing = (): boolean => panel().classList.contains('ready') && btn().classList.contains('ready');
  beforeEach(() => { ui = mount(<div />); });
  afterEach(() => { ui.unmount(); });

  it.each(CASES)('$hero: the existing ready classes while armed, off again the moment it fires, counter kept', ({ hero, before, armed, fired, pills }) => {
    show(run(hero, before));
    expect(glowing()).toBe(false);
    expect(pill()).toBe(pills[0]);

    show(run(hero, armed));
    expect(panel().classList.contains('passive'), 'still a passive power').toBe(true);
    expect(glowing()).toBe(true);
    expect(ui.container.querySelector('.statusbar')!.classList.contains('shopphase'), 'the ready call is keyed on the Shop').toBe(true);
    expect(btn().disabled, 'still not a button to press').toBe(true);
    expect(btn().hasAttribute('title')).toBe(false);
    expect(pill()).toBe(pills[1]);
    expect(pillEl()!.classList.contains('payout')).toBe(false);

    show(run(hero, fired));
    expect(glowing()).toBe(false);
    expect(pill()).toBe(pills[2]);
  });

  it.each(CASES)('$hero: no stale glow in combat', ({ hero, armed }) => {
    show(run(hero, { ...armed, phase: 'combat' }));
    expect(btn().classList.contains('ready')).toBe(false);
    expect(panel().classList.contains('ready')).toBe(false);
  });

  it('Quillen: the pill turns gold at 2/3 while the power can be pressed, and not at 1/3', () => {
    show(run('quillen', { archivedTribes: ['beast'], heroReady: true }));
    expect(pill()).toBe('1/3');
    expect(glowing(), 'a pressable power wears the ready call at any count').toBe(true);
    expect(pillEl()!.classList.contains('payout')).toBe(false);

    show(run('quillen', { archivedTribes: ['beast', 'dragon'], heroReady: true }));
    expect(pill()).toBe('2/3');
    expect(glowing()).toBe(true);
    expect(pillEl()!.classList.contains('payout')).toBe(true);

    show(run('quillen', { archivedTribes: [], heroReady: false })); // it just filled: Discover open, used for the turn
    expect(pill()).toBe('0/3');
    expect(pillEl()!.classList.contains('payout')).toBe(false);
  });

  it('Quillen at 2/3 but already used this turn: no call and a plain pill (the rule for any active power)', () => {
    show(run('quillen', { archivedTribes: ['beast', 'dragon'], heroReady: false }));
    expect(pill()).toBe('2/3');
    expect(glowing()).toBe(false);
    expect(pillEl()!.classList.contains('payout')).toBe(false);
  });
});
