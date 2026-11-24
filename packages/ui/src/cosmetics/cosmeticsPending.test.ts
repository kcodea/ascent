/**
 * THE COSMETICS WINDOW'S PENDING LOADOUT (showcase player card, PR 3 Task 6): the window edits one pending copy of your
 * four cosmetics (avatar, frame, title, card plate) and "Use" saves only what changed. A failed save is reported by key,
 * and the other saves still run.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyPending, changedKeys, type Loadout4 } from './cosmeticsPending';

const now: Loadout4 = { avatar: 'hero:albus', frame: null, title: 'title_wanderer', plate: null };

function savers(fail: Partial<Record<keyof Loadout4, boolean>> = {}) {
  return {
    avatar: vi.fn((_id: string | null) => undefined),
    frame: vi.fn(async (_id: string | null) => !fail.frame),
    title: vi.fn(async (_id: string | null) => !fail.title),
    plate: vi.fn(async (_id: string | null) => !fail.plate),
  };
}

describe('changedKeys', () => {
  it('is empty when nothing changed', () => {
    expect(changedKeys(now, { ...now })).toEqual([]);
  });
  it('returns only the keys that differ', () => {
    expect(changedKeys(now, { ...now, frame: 'frame_honey', title: null })).toEqual(['frame', 'title']);
  });
});

describe('applyPending', () => {
  it('calls only the savers of changed keys, with the pending value', async () => {
    const s = savers();
    const failed = await applyPending(now, { ...now, plate: 'plate_bamboo', avatar: null }, s);
    expect(failed).toEqual([]);
    expect(s.avatar).toHaveBeenCalledWith(null);
    expect(s.plate).toHaveBeenCalledWith('plate_bamboo');
    expect(s.frame).not.toHaveBeenCalled();
    expect(s.title).not.toHaveBeenCalled();
  });

  it('a saver resolving false is returned as failed while the others still ran', async () => {
    const s = savers({ title: true });
    const failed = await applyPending(now, { avatar: null, frame: 'frame_honey', title: null, plate: 'plate_bamboo' }, s);
    expect(failed).toEqual(['title']);
    expect(s.avatar).toHaveBeenCalledTimes(1);
    expect(s.frame).toHaveBeenCalledWith('frame_honey');
    expect(s.plate).toHaveBeenCalledWith('plate_bamboo');
  });

  it('a saver that throws counts as failed', async () => {
    const s = { ...savers(), frame: vi.fn(async () => { throw new Error('offline'); }) };
    expect(await applyPending(now, { ...now, frame: 'frame_honey' }, s)).toEqual(['frame']);
  });
});
