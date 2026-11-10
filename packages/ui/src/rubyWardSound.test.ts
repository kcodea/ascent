import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const calls: string[] = [];
vi.mock('./sfx', () => ({
  sfx: new Proxy({} as Record<string, unknown>, { get: (t, k: string) => (t[k] ??= vi.fn(() => { calls.push(k); })) }),
  playGenericCastSound: vi.fn(),
}));
import { createRun, reduce, type RunState, type BoardCard } from '@game/sim';
import { actionSfx, RUBY_WARD_SOUND_DELAY_MS } from './store';

/**
 * A Warding Ruby on a Kobold grants Ward on the same dispatch the gem lands. The Ward sound rang at that same
 * instant and was buried under the gem's landing sound (owner report 2026-11-10: "the ward sound effect didnt play
 * alongside the ruby apply sound"). It now rings a beat after the gem, so it reads as its own hit.
 */
const kobold = (uid: string): BoardCard =>
  ({ uid, cardId: 'sandbag', tribe: 'kobold', attack: 2, health: 2, keywords: [], golden: false }) as BoardCard;

describe('a Ruby-granted Ward sounds a beat after the gem lands', () => {
  beforeEach(() => { calls.length = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('Warding Ruby on a Kobold: no Ward sound at the drop, one after the delay', () => {
    const s: RunState = { ...createRun(1), board: [kobold('kob')], hand: [] };
    s.hand.push({ uid: 'r1', cardId: 'warding-ruby', tribe: 'neutral', attack: 1, health: 2, keywords: [], golden: false } as never);
    const next = reduce(s, { type: 'play', uid: 'r1', targetUid: 'kob' });
    expect(next.board[0]!.keywords).toContain('DS');
    actionSfx({ type: 'play', uid: 'r1', targetUid: 'kob' } as never, s, next);
    expect(calls).not.toContain('shield');
    vi.advanceTimersByTime(RUBY_WARD_SOUND_DELAY_MS);
    expect(calls.filter((c) => c === 'shield')).toHaveLength(1);
  });

  it('a Ward gained some other way still sounds at once', () => {
    const prev: RunState = { ...createRun(1), board: [kobold('kob')], hand: [] };
    const next: RunState = { ...prev, board: [{ ...kobold('kob'), keywords: ['DS'] }] };
    actionSfx({ type: 'reposition', from: 0, to: 0 } as never, prev, next);
    expect(calls).toContain('shield');
  });
});
