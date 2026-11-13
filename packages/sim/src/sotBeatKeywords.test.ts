import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun } from './state';
import { recordSotBeat } from './sotBeat';
import type { BoardCard, RunState } from './state';

/**
 * A START OF TURN SOURCE THAT GIVES A KEYWORD (R-FX-KEYWORD-ORIGIN-01, owner 2026-11-13: "these effects should come
 * from runes that apply these effects to minions"): the recorder notes the gain on the source's own beat, so the Shop
 * can send the keyword's beam from that source.
 */
const bc = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false } as BoardCard;
};
const run = (): RunState => ({ ...createRun(5, 'warden', 'ascent'), board: [bc('a', 'b2_beev'), bc('b', 'b2_beev')], sotBeatFx: [] }) as unknown as RunState;
const rune = { kind: 'rune' as const, id: 'rune_test', label: 'Test' };

describe('the Start of Turn recorder notes keyword gains', () => {
  it('a source that only gives keywords still gets its own beat, naming each gain', () => {
    const s = run();
    recordSotBeat(s, rune, () => { s.board[0]!.keywords.push('CR'); s.board[1]!.keywords.push('R', 'DS'); });
    expect(s.sotBeatFx).toHaveLength(1);
    expect(s.sotBeatFx![0]!.source).toEqual(rune);
    expect(s.sotBeatFx![0]!.keywords).toEqual([{ uid: 'a', keyword: 'CR' }, { uid: 'b', keyword: 'R' }, { uid: 'b', keyword: 'DS' }]);
  });
  it('a keyword the minion already had is not a gain, and a source that gives none records no keywords', () => {
    const s = run();
    s.board[0]!.keywords.push('CR');
    recordSotBeat(s, rune, () => { if (!s.board[0]!.keywords.includes('CR')) s.board[0]!.keywords.push('CR'); });
    expect(s.sotBeatFx).toHaveLength(0);
    recordSotBeat(s, rune, () => { s.board[0]!.attack += 2; });
    expect(s.sotBeatFx![0]!.keywords).toBeUndefined();
  });
  it('a body that arrived this beat is a summon, not a keyword gain', () => {
    const s = run();
    recordSotBeat(s, rune, () => { s.board.push({ ...bc('n', 'b2_beev'), keywords: ['CR'] } as BoardCard); });
    expect(s.sotBeatFx![0]!.keywords).toBeUndefined();
    expect(s.sotBeatFx![0]!.summons).toEqual(['n']);
  });
});
