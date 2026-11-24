// @vitest-environment jsdom
/**
 * WIZENED GEMS, PETAH, FURLBOGGEN, HUNTSMAN (owner 2026-11-23), the live-text half: Huntsman prints the doubled Shop gain on
 * the Shop board and its printed gain in combat, hand and everywhere else; the two others are exact as printed; the Wizened
 * Gems badge counts x/3. Engine half: packages/sim/src/wizenedRunes1123.test.ts.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { CARD_INDEX } from '@game/content';
import type { Keyword } from '@game/core';
import { createRun, type BoardCard, type RunState } from '@game/sim';
import { destroyMinionInShop, makeContext } from '../../sim/src/recruit';
import { instView } from './instView';
import { discoverCardText, handCardView, handLiveOf } from './Recruit';
import { Unit } from './Unit';
import { runeTally } from './runeTally';
import { useGame } from './store';
import { artFor, runeArt } from './art';
import { descTextOf, mount } from './renderedText.mount';

const card = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1, 'runesmith', 'ascent', undefined, 'set2'), phase: 'recruit', tier: 6, hand: [], board: [], ...over } as RunState);
const shown = (v: { text?: string; goldenText?: string }, golden: boolean): string => (golden ? v.goldenText : undefined) ?? v.text ?? '';
const board = (c: BoardCard): string => shown(instView(c, 6, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { ...handLiveOf(run(), {}, {} as never), onBoard: true }), !!c.golden);
const hand = (c: BoardCard): string => shown(handCardView(run(), c, handLiveOf(run(), {}, {} as never)), !!c.golden);

const m = mount(null);
afterAll(() => m.unmount());
function combat(cardId: string, golden: boolean, side: 'you' | 'foe'): string {
  const d = CARD_INDEX[cardId]!;
  const frame = {
    uid: `u-${cardId}`, cardId: d.id, name: d.name, tribe: d.tribe, attack: d.attack, health: d.health,
    keywords: [...d.keywords] as Keyword[], divineShield: false, alive: true, golden, summonBonus: 0,
    baseAttack: d.attack, baseHealth: d.health,
  };
  act(() => { useGame.setState({ run: run(), compactCards: false }); });
  m.render(<Unit u={frame} side={side} />);
  return descTextOf(m.container);
}

describe('Huntsman prints what a death pays right now', () => {
  it.each([[false, 6, 12], [true, 12, 24]] as const)('golden=%s: the Shop board prints the gain a Shop death really pays', (golden, plain, doubled) => {
    const s = run({ board: [card('H', 'n2_huntsman', { golden }), card('v', 'sandbag')] });
    expect(board(s.board[0]!)).toBe(`When any minion dies, gain **+${plain}/+${plain}** permanently. Gains **double** in the Shop {{(+${doubled}/+${doubled} now)}}.`);
    destroyMinionInShop(makeContext(s), s.board[1]!);
    expect(s.board[0]!.attack).toBe(12 + doubled);
  });
  it.each([[false, 6], [true, 12]] as const)('golden=%s: combat (both sides), hand and Discover print the plain rule', (golden, plain) => {
    const rule = `When any minion dies, gain **+${plain}/+${plain}** permanently. Gains **double** in the Shop.`;
    expect(hand(card('h', 'n2_huntsman', { golden }))).toBe(rule);
    if (!golden) expect(discoverCardText(run(), 'n2_huntsman', {}).text).toBe(rule);
    for (const side of ['you', 'foe'] as const) expect(combat('n2_huntsman', golden, side)).toBe(rule.replace(/\*\*/g, ''));
  });
  it('only Huntsman carries the note', () => {
    expect(board(card('b', 'n2_spellmaiden'))).not.toContain('now)');
  });
});

describe('Petah and Furlboggen are exact as printed on every surface', () => {
  it.each(['b2_petah', 'k_furlboggen'])('%s', (id) => {
    for (const golden of [false, true]) {
      const t = golden ? CARD_INDEX[id]!.goldenText! : CARD_INDEX[id]!.text;
      expect(board(card('b', id, { golden }))).toBe(t);
      expect(hand(card('h', id, { golden }))).toBe(t);
      expect(combat(id, golden, 'you')).toBe(t.replace(/\*\*/g, ''));
    }
  });
});

describe('the Wizened Gems badge', () => {
  it('counts x/3, and nothing without the rune', () => {
    expect(runeTally(run({ questFlags: { runeWizenedGems: true }, runeWizenedGemsTick: 2 }), 'rune_wizened_gems')).toBe('2/3');
    expect(runeTally(run({ questFlags: { runeWizenedGems: true } }), 'rune_wizened_gems')).toBe('0/3');
    expect(runeTally(run(), 'rune_wizened_gems')).toBeNull();
  });
});

describe('art (owner ask 2026-11-23: the four runes; the three minions have none yet)', () => {
  it.each(['rune_wizened_gems', 'rune_petah', 'rune_furlboggen', 'rune_huntsman'])('%s resolves through the real rune art lookup', (id) => {
    expect(runeArt(id)).toMatch(new RegExp(`${id}[^/]*\.webp`));
  });
  it.each(['b2_petah', 'k_furlboggen', 'n2_huntsman'])('%s does not borrow its rune art', (id) => {
    expect(artFor(id) ?? '').not.toContain('rune_');
  });
});
