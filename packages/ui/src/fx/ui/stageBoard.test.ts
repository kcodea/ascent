import { describe, expect, it } from 'vitest';
import type { CardDef } from '@game/core';
import {
  FX_STAGE_SLOTS,
  defaultStageBoard,
  setStageCard,
  stageUid,
  stageUnitOptions,
} from './stageBoard';

const card = (id: string, keywords: CardDef['keywords'] = [], tier = 1): CardDef =>
  ({ id, name: id.toUpperCase(), tribe: 'neutral', tier, attack: 1, health: 1, keywords, effects: [], text: '' }) as CardDef;

const POOL: CardDef[] = [
  card('plainb'),
  card('taunta', ['T']),
  card('shielda', ['DS']),
  card('plaina'),
  card('tauntb', ['T']),
  card('shieldb', ['DS']),
  card('rushy', ['W']),
];

describe('the workbench stage board', () => {
  it('fills both sides', () => {
    const b = defaultStageBoard(POOL);
    expect(b.you).toHaveLength(FX_STAGE_SLOTS);
    expect(b.foe).toHaveLength(FX_STAGE_SLOTS);
  });

  it('uids are positional, so a saved preview subject still points at its slot next session', () => {
    const b = defaultStageBoard(POOL);
    expect(b.you.map((u) => u.uid)).toEqual(['fxs-you-0', 'fxs-you-1', 'fxs-you-2']);
    expect(b.foe.map((u) => u.uid)).toEqual(['fxs-foe-0', 'fxs-foe-1', 'fxs-foe-2']);
    // And the uid survives a card swap — that is what keeps the pick pointed somewhere real.
    expect(setStageCard(b, 'you', 1, 'rushy').you[1]).toEqual({ uid: stageUid('you', 1), cardId: 'rushy' });
  });

  it('is deterministic — the same pool always stages the same six, in any input order', () => {
    const a = defaultStageBoard(POOL);
    const b = defaultStageBoard([...POOL].reverse());
    expect(b).toEqual(a);
  });

  it('reaches for visual variety: a taunt and a shielded unit before a plain one', () => {
    const b = defaultStageBoard(POOL);
    const ids = [...b.you, ...b.foe].map((u) => u.cardId);
    expect(ids).toContain('taunta');
    expect(ids).toContain('shielda');
    // Six distinct cards from a pool that can supply them — a board of six identical minions tells an author
    // nothing about how an effect reads across a row.
    expect(new Set(ids).size).toBe(6);
  });

  it('a pool too small to fill six slots repeats rather than leaving holes', () => {
    const b = defaultStageBoard([card('only')]);
    expect([...b.you, ...b.foe].every((u) => u.cardId === 'only')).toBe(true);
    expect(b.you).toHaveLength(FX_STAGE_SLOTS);
  });

  it('an empty pool stages nothing rather than undefined cards', () => {
    expect(defaultStageBoard([])).toEqual({ you: [], foe: [] });
  });

  it('setStageCard touches only its own slot', () => {
    const b = defaultStageBoard(POOL);
    const next = setStageCard(b, 'foe', 2, 'rushy');
    expect(next.foe[2].cardId).toBe('rushy');
    expect(next.foe[0]).toEqual(b.foe[0]);
    expect(next.you).toEqual(b.you);
  });

  it('picker options read enemies first, top-to-bottom as they appear on screen', () => {
    const b = defaultStageBoard(POOL);
    const opts = stageUnitOptions(b, (id) => id.toUpperCase());
    expect(opts).toHaveLength(6);
    expect(opts[0].uid).toBe('fxs-foe-0');
    expect(opts[0].label).toMatch(/^Enemy 1 — /);
    expect(opts[3].uid).toBe('fxs-you-0');
    expect(opts[3].label).toMatch(/^Yours 1 — /);
  });
});
