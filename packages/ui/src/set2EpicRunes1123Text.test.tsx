// @vitest-environment jsdom
/**
 * SET 2 EPIC RUNES (owner 2026-11-23), the live-text half: Deep Bond (Mountainbond prints 5), Uninvited Guests (Party
 * Crasher prints Kobolds and Beasts), Spellmaiden (what her sale gives now), Golden Bell / Gilded Wings (no Triple
 * Reward, in hand). Every surface: Shop offer, Discover, hand, board (`liveBoardView`) and the real combat `Unit`.
 * Engine half: packages/sim/src/set2EpicRunes1123.test.ts.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { CARD_INDEX } from '@game/content';
import type { Keyword } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState, type ShopCard } from '@game/sim';
import { instView, liveBoardView } from './instView';
import { stepProgress } from './cardText';
import { discoverCardText, handCardView, handLiveOf, liveOptsFromRun, shopView } from './Recruit';
import { Unit } from './Unit';
import { useGame } from './store';
import { artFor } from './art';
import { descTextOf, mount } from './renderedText.mount';

const card = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1, 'runesmith', 'ascent', undefined, 'set2'), phase: 'recruit', tier: 6, hand: [], board: [], ...over } as RunState);
const hand = (s: RunState, c: BoardCard): string => {
  const v = handCardView(s, c, handLiveOf(s, {}, {} as never));
  return (c.golden ? v.goldenText : undefined) ?? v.text ?? '';
};
const board = (s: RunState, c: BoardCard): string => {
  const v = liveBoardView(c, s);
  return (c.golden ? v.goldenText : undefined) ?? v.text ?? '';
};
/** Every surface a fresh copy can be read on before combat. */
const surfaces = (s: RunState, cardId: string): Record<string, string | undefined> => ({
  shop: shopView({ uid: 's', cardId } as ShopCard, liveOptsFromRun(s)).text,
  discover: discoverCardText(s, cardId, {}).text,
  hand: hand(s, card('h', cardId)),
  board: board(s, card('b', cardId)),
});

const m = mount(null);
afterAll(() => m.unmount());
/** The combat chain: the real `Unit`, player side, on this run. */
function combat(s: RunState, cardId: string, side: 'you' | 'foe' = 'you'): string {
  const d = CARD_INDEX[cardId]!;
  const frame = {
    uid: `u-${cardId}`, cardId: d.id, name: d.name, tribe: d.tribe, attack: d.attack, health: d.health,
    keywords: [...d.keywords] as Keyword[], divineShield: false, alive: true, golden: false, summonBonus: 0,
    baseAttack: d.attack, baseHealth: d.health,
  };
  act(() => { useGame.setState({ run: s, compactCards: false }); });
  m.render(<Unit u={frame} side={side} />);
  return descTextOf(m.container);
}

describe('Deep Bond: Mountainbond prints the live 5', () => {
  const on = run({ questFlags: { runeDeepBond: true } });
  it('on every surface; the printed 8 without the rune', () => {
    for (const [k, t] of Object.entries(surfaces(on, 'dw_mountainbond'))) expect(t, k).toContain('Every {{5 Gold}} spent');
    for (const [k, t] of Object.entries(surfaces(run(), 'dw_mountainbond'))) expect(t, k).toContain('Every **8 Gold** spent');
  });
  it('Gilded too', () => {
    expect(hand(on, card('h', 'dw_mountainbond', { golden: true }))).toContain('Every {{5 Gold}} spent, cast **2 Rubies**');
  });
  it('the board meter counts to 5 with it and to 8 without it', () => {
    const view = (s: RunState) => instView(
      card('b', 'dw_mountainbond', { goldTick: 3 }), 6, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined,
      { ...handLiveOf(s, {}, {} as never), onBoard: true },
    ).stepProgress;
    expect(view(on)).toEqual({ current: 3, total: 5 });
    expect(view(run())).toEqual({ current: 3, total: 8 });
    expect(stepProgress('dw_billings', { goldTick: 3, deepBond: true })?.total, 'only the Mountainbond').toBe(stepProgress('dw_billings', { goldTick: 3 })?.total);
  });
  it('combat prints it too', () => {
    expect(combat(on, 'dw_mountainbond')).toContain('Every 5 Gold spent');
    expect(combat(run(), 'dw_mountainbond')).toContain('Every 8 Gold spent');
  });
});

describe('Uninvited Guests: Party Crasher prints Kobolds and Beasts', () => {
  const on = run({ questFlags: { runeUninvitedGuests: true } });
  it('on every surface, plain and Gilded; the printed Kobolds without the rune', () => {
    for (const [k, t] of Object.entries(surfaces(on, 'k_gemstorm'))) expect(t, k).toContain('on your {{Kobolds and Beasts}}.');
    for (const [k, t] of Object.entries(surfaces(run(), 'k_gemstorm'))) expect(t, k).toContain('on your **Kobolds**.');
    expect(hand(on, card('h', 'k_gemstorm', { golden: true }))).toContain('**6 permanent Rubies** on your {{Kobolds and Beasts}}');
  });
  it('combat prints it too', () => {
    expect(combat(on, 'k_gemstorm')).toContain('Kobolds and Beasts');
    expect(combat(run(), 'k_gemstorm')).not.toContain('Beasts');
  });
});

describe('Spellmaiden prints what her sale gives right now', () => {
  const s = run({ spellBonus: { attack: 3, health: 2 } });
  it('the printed gain equals what the sale really adds, plain (x2) and Gilded (x3)', () => {
    for (const golden of [false, true]) {
      const before = { ...s, board: [card('b', 'n2_spellmaiden', { golden })] } as RunState;
      const after = reduce(before, { type: 'sell', uid: 'b' }) as RunState;
      const gain = { attack: after.spellBonus.attack - 3, health: after.spellBonus.health - 2 };
      expect(gain).toEqual(golden ? { attack: 6, health: 4 } : { attack: 3, health: 2 });
      expect(board(before, before.board[0]!)).toContain(`{{(Gain +${gain.attack}/+${gain.health} now.)}}`);
      expect(hand(before, card('h', 'n2_spellmaiden', { golden }))).toContain(`{{(Gain +${gain.attack}/+${gain.health} now.)}}`);
    }
  });
  it('nothing banked prints the plain rule', () => {
    expect(hand(run(), card('h', 'n2_spellmaiden'))).toBe('When sold, **double** your **Shop spell power**.');
  });
  it('a fight that raises spell power moves it live, in combat and in hand', () => {
    const mid = { ...s, fxSpellPowerPreview: { attack: 2, health: 1 } } as RunState;
    expect(combat(s, 'n2_spellmaiden')).toContain('Gain +3/+2 now.');
    expect(combat(mid, 'n2_spellmaiden')).toContain('Gain +5/+3 now.');
    expect(hand(mid, card('h', 'n2_spellmaiden'))).toContain('{{(Gain +5/+3 now.)}}');
  });
});

describe('Golden Bell / Gilded Wings: the granted copy says it gives no Triple Reward, in hand only', () => {
  it.each(['n2_bellringer', 'd2_transcendence'])('%s', (id) => {
    const marked = card('h', id, { golden: true, noTripleReward: true });
    expect(hand(run(), marked)).toContain('[[No Triple Reward when played.]]');
    expect(board(run(), marked)).not.toContain('Triple Reward');
    expect(hand(run(), card('h', id, { golden: true })), 'an ordinary Gilded copy').not.toContain('Triple Reward');
  });
});

describe('Spellmaiden art (owner ask 2026-11-23)', () => {
  it('resolves through the real art lookup by card id', () => {
    expect(artFor('n2_spellmaiden')).toMatch(/n2_spellmaiden[^/]*\.webp/);
  });
});
