import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from '@game/sim';
import { aleBubbleSources } from './aleBubbleSources';

/**
 * R-ALEFX-01 — an End-of-Turn Ale's bubbles play ONCE (Doubletap Brewer since the owner balance 2026-10-10; it was
 * Brunni's). The End-of-Turn beat (`cardGranted` in Recruit.tsx) owns that burst; the reactive `aleGrantSeq` watcher
 * must not replay it when the `faceOmen` commit stamps `aleGranted` with the warband still on screen. Shop-action
 * ales (Tapkeeper's Gold meter; it was Doubletap Brewer's Shout until 2026-10-10) still burst.
 */

const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const body = (cardId: string, uid: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};

describe('aleBubbleSources (R-ALEFX-01)', () => {
  it('the End-of-Turn commit stamps Doubletap Brewer but the watcher fires nothing (the beat already did)', () => {
    let s = set2();
    s = { ...s, phase: 'recruit', board: [body('dw_brewer', 'brunni')], hand: [] };
    const seq0 = s.aleGrantSeq;
    s = reduce(s, { type: 'faceOmen' });
    expect(s.aleGrantSeq, 'the commit still bumps the seq').toBe(seq0 + 1);
    expect(s.aleGranted.map((e) => e.sourceUid)).toContain('brunni');
    expect(aleBubbleSources(s)).toEqual([]);
  });

  it('a shop-action ale (Tapkeeper, 10 Gold spent) still bursts from its unit, once', () => {
    let s = set2();
    s = { ...s, phase: 'recruit', embers: 30, freeRolls: 0, board: [body('dw_tapkeeper', 'brewer')], hand: [] };
    for (let i = 0; i < 10 && s.aleGranted.length === 0; i++) s = reduce(s, { type: 'roll' });
    expect(s.phase).toBe('recruit');
    expect(aleBubbleSources(s)).toEqual(['brewer']);
  });

  it('dedupes multiple ales from one unit to one burst', () => {
    const s = { phase: 'recruit', aleGranted: [{ sourceUid: 'a', count: 1 }, { sourceUid: 'a', count: 1 }] } as const;
    expect(aleBubbleSources(s as never)).toEqual(['a']);
  });
});
