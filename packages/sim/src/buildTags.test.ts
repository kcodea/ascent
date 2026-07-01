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
    expect(tags.length).toBeLessThanOrEqual(3);
    expect(tags.length).toBeGreaterThan(0);
  });
});
