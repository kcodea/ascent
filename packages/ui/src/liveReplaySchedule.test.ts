import { describe, expect, it } from 'vitest';
import type { Action } from '@game/sim';
import { buildLiveReplaySchedule, liveFireAt, shopDifferences, type RecordedFrame } from './liveReplaySchedule';

const A = (a: object): Action => a as Action;

describe('buildLiveReplaySchedule', () => {
  const frames: RecordedFrame[] = [
    { kind: 'shop', tMs: 0, wave: 1, view: { shop: [{ cardId: 'a' }] } },
    { kind: 'shopDelta', tMs: 1000, cause: 'buy' },
    { kind: 'combat', tMs: 3000, wave: 1 },
    { kind: 'shop', tMs: 9000, wave: 2, view: { shop: [{ cardId: 'b' }] } },
    { kind: 'shopDelta', tMs: 10_500, cause: 'play' },
  ];
  const actions = [
    A({ type: 'buy', uid: 's0' }),
    A({ type: 'freeze' }), // changed nothing for the player: no frame
    A({ type: 'faceOmen' }),
    A({ type: 'settleCombat' }),
    A({ type: 'resolveCombat' }),
    A({ type: 'play', uid: 'b1' }),
  ];

  it('matches shop actions to their frames by cause, in order', () => {
    const s = buildLiveReplaySchedule(actions, frames);
    expect(s[0]).toEqual({ kind: 'action', action: actions[0], tMs: 1000 });
    expect(s[1]).toEqual({ kind: 'action', action: actions[1], tMs: null });
    expect(s[4]).toEqual({ kind: 'action', action: actions[5], tMs: 10_500 });
  });

  it('turns faceOmen into End Turn and resolveCombat into End Combat with the next shop', () => {
    const s = buildLiveReplaySchedule(actions, frames);
    expect(s[2]).toEqual({ kind: 'endTurn', tMs: 3000, wave: 1 });
    expect(s[3]).toMatchObject({ kind: 'endCombat', tMs: 9000 });
    expect(s[3]!.kind === 'endCombat' && s[3]!.shop?.view?.shop?.[0]?.cardId).toBe('b');
  });

  it('leaves settleCombat to the combat screen (never a step)', () => {
    const s = buildLiveReplaySchedule(actions, frames);
    expect(s).toHaveLength(5);
    expect(s.some((x) => x.kind === 'action' && x.action.type === 'settleCombat')).toBe(false);
  });
});

describe('liveFireAt', () => {
  it('keeps the player gap measured from the shop opening', () => {
    expect(liveFireAt(10_500, 9000, 50_000, 50_000, 1)).toBe(51_500);
  });
  it('speed compresses the gap', () => {
    expect(liveFireAt(10_500, 9000, 50_000, 50_000, 2)).toBe(50_750);
  });
  it('never fires before the previous step plus the minimum gap', () => {
    expect(liveFireAt(9100, 9000, 50_000, 50_500, 1)).toBe(50_540);
    expect(liveFireAt(null, 9000, 50_000, 50_500, 1)).toBe(50_540);
  });
});

describe('shopDifferences', () => {
  const live = { shop: [{ cardId: 'a' }], hand: [], board: [{ cardId: 'x', attack: 2, health: 3 }], embers: 5, tier: 2 };
  it('is empty when the live shop is the recorded one', () => {
    expect(shopDifferences({ shop: [{ cardId: 'a' }], hand: [], board: [{ cardId: 'x', attack: 2, health: 3 }], embers: 5, tier: 2 }, live)).toEqual([]);
  });
  it('names each field that drifted', () => {
    const d = shopDifferences({ shop: [{ cardId: 'b' }], hand: [], board: [{ cardId: 'x', attack: 3, health: 3 }], embers: 5, tier: 2 }, live);
    expect(d.map((x) => x.split(':')[0])).toEqual(['shop', 'board']);
  });
});

describe('actions the game dispatches itself', () => {
  it('are never steps, and their frames are skipped so the next action keeps its own time', () => {
    const frames: RecordedFrame[] = [
      { kind: 'shop', tMs: 0 },
      { kind: 'shopDelta', tMs: 500, cause: 'shopClockExpired' },
      { kind: 'shopDelta', tMs: 700, cause: 'sell' },
    ];
    const s = buildLiveReplaySchedule([A({ type: 'shopClockExpired' }), A({ type: 'combatFriendlyDeathPreview', count: 1 }), A({ type: 'sell', uid: 'b1' })], frames);
    expect(s).toEqual([{ kind: 'action', action: { type: 'sell', uid: 'b1' }, tMs: 700 }]);
  });
});
