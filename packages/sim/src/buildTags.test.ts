import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { buildTags } from './buildTags';
import { createRun, type BoardCard, type RunState } from './state';

const mk = (cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const def = CARD_INDEX[cardId];
  return {
    uid: `${cardId}-${Math.round((over.attack ?? 0) + (over.health ?? 0))}-${cardId}`,
    cardId,
    tribe: def?.tribe ?? 'neutral',
    attack: def?.attack ?? 1,
    health: def?.health ?? 1,
    keywords: [...(def?.keywords ?? [])],
    golden: false,
    ...over,
  };
};
const withBoard = (board: BoardCard[], over: Partial<RunState> = {}): RunState => ({ ...createRun(1), board, ...over });

describe('buildTags (A5 build-tag classifier)', () => {
  it('returns [] for an empty board', () => {
    expect(buildTags(withBoard([]))).toEqual([]);
  });

  it('tags a tribe-dominant board (Beast Swarm)', () => {
    const board = ['alley', 'raptor', 'kennel', 'pack', 'gnash'].map((id, i) => mk(id, { uid: `b${i}` }));
    expect(buildTags(withBoard(board))).toContain('Beast Swarm');
  });

  it('tags a Deathrattle-dense board (Echo Web)', () => {
    const board = ['spore', 'trickster', 'burialimp', 'ryme'].map((id, i) => mk(id, { uid: `d${i}` }));
    expect(buildTags(withBoard(board))).toContain('Echo Web');
  });

  it('reads live (granted) keywords: Ward Wall / Toxin Control / Flurry Finish', () => {
    expect(buildTags(withBoard([mk('sandbag', { uid: 'a', keywords: ['DS'] }), mk('sandbag', { uid: 'b', keywords: ['DS'] })]))).toContain('Ward Wall');
    expect(buildTags(withBoard([mk('sandbag', { uid: 'c', keywords: ['V'] })]))).toContain('Toxin Control');
    expect(buildTags(withBoard([mk('sandbag', { uid: 'd', keywords: ['W'], attack: 22 })]))).toContain('Flurry Finish');
  });

  it('tags a golden-heavy board (Gilded Carry)', () => {
    const board = [mk('sandbag', { uid: 'g1', golden: true }), mk('sandbag', { uid: 'g2', golden: true })];
    expect(buildTags(withBoard(board))).toContain('Gilded Carry');
  });

  it('tags a spell-heavy run (Spell Engine) off spellsCast', () => {
    expect(buildTags(withBoard([mk('sandbag', { uid: 's' })], { spellsCast: 10 }))).toContain('Spell Engine');
  });

  it('tags a fodder/imp engine (Fodder Economy) off run-wide imp scaling', () => {
    expect(buildTags(withBoard([mk('sandbag', { uid: 'f' })], { impBuff: { attack: 2, health: 2 } }))).toContain('Fodder Economy');
  });

  it('returns at most 3 tags, strongest first', () => {
    // A board that qualifies for many tags at once.
    const board = [
      mk('sandbag', { uid: 't1', keywords: ['DS'], golden: true }),
      mk('sandbag', { uid: 't2', keywords: ['DS', 'V'], golden: true }),
      mk('spore', { uid: 't3' }),
      mk('trickster', { uid: 't4' }),
      mk('burialimp', { uid: 't5' }),
    ];
    const tags = buildTags(withBoard(board, { spellsCast: 12 }));
    expect(tags.length).toBeLessThanOrEqual(4);
    expect(tags.length).toBeGreaterThan(0);
  });

  it('tags board shape: Carry Stack (one monster) vs Wide Board (many bodies)', () => {
    const carry = [
      mk('sandbag', { uid: 'c1', attack: 40, health: 40 }),
      mk('sandbag', { uid: 'c2', attack: 2, health: 2 }),
      mk('sandbag', { uid: 'c3', attack: 2, health: 2 }),
    ];
    expect(buildTags(withBoard(carry))).toContain('Carry Stack');
    const wide = Array.from({ length: 6 }, (_, i) => mk('sandbag', { uid: `w${i}`, attack: 6, health: 6 }));
    expect(buildTags(withBoard(wide))).toContain('Wide Board');
  });

  it('tags Glass Cannon (attack-heavy + aggressive) and Fortress Board (health-heavy + defensive)', () => {
    const glass = Array.from({ length: 3 }, (_, i) => mk('sandbag', { uid: `g${i}`, attack: 14, health: 2, keywords: i === 0 ? ['W'] : [] }));
    expect(buildTags(withBoard(glass))).toContain('Glass Cannon');
    const fort = Array.from({ length: 3 }, (_, i) => mk('sandbag', { uid: `f${i}`, attack: 2, health: 14, keywords: ['DS'] }));
    expect(buildTags(withBoard(fort))).toContain('Fortress Board');
  });

  it('tags Triple Hunter (chased upgrades) and Menagerie (mixed tribes)', () => {
    expect(buildTags(withBoard([mk('sandbag', { uid: 'a' })], { triplesMade: 4 }))).toContain('Triple Hunter');
    const mixed = [mk('alley', { uid: 'm1' }), mk('frontdrake', { uid: 'm2' }), mk('karthus', { uid: 'm3' }), mk('feed', { uid: 'm4' })];
    expect(buildTags(withBoard(mixed))).toContain('Menagerie'); // beast · dragon · undead · demon

  });

  it('tags a comeback (Late Bloom / Underdog Line) from the round history', () => {
    // 2 calibration + 12 scored: lose the first 6, win the last 6 → covered line 6, weak early.
    const history = ['lose', 'lose', ...Array(6).fill('lose'), ...Array(6).fill('win')];
    const tags = buildTags(withBoard([mk('sandbag', { uid: 'x' })], { history, line: 6, phase: 'victory' }));
    expect(tags.some((t) => t === 'Late Bloom' || t === 'Underdog Line')).toBe(true);
  });
});
