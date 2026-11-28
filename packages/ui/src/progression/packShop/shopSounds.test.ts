import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ ctx: null as unknown, clips: [] as { clip: string; category: string; gain: number }[] }));
vi.mock('../../sfx', () => ({
  audioContext: () => h.ctx,
  playTailedClip: (clip: string, category: string, o: { gain: number }) => { h.clips.push({ clip, category, gain: o.gain }); return null; },
}));

import { SHOP_CUES, createShopSounds, type ShopSounds } from './shopSounds';

const callAll = (s: ShopSounds): void => {
  s.pickUp(); s.shake(); s.overLine(); s.till(); s.land(); s.refuse(); s.rack(); s.play(); s.dispose();
};

describe('shopSounds', () => {
  beforeEach(() => { h.ctx = null; h.clips.length = 0; });

  it('every cue is a recorded clip that exists on disk, at a gain above 0', () => {
    const audio = fileURLToPath(new URL('../../audio/', import.meta.url));
    const lists = Object.values(SHOP_CUES);
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) {
      expect(list.length).toBeGreaterThan(0);
      for (const cue of list) {
        const found = ['.mp3', '.wav', '.ogg'].some((ext) => { try { readFileSync(audio + cue.clip + ext); return true; } catch { return false; } });
        expect(found, cue.clip).toBe(true);
        expect(cue.gain, cue.clip).toBeGreaterThan(0);
      }
    }
  });

  it('every method is a no-op before any user gesture (no AudioContext)', () => {
    expect(() => callAll(createShopSounds())).not.toThrow();
    expect(h.clips).toHaveLength(0);
  });

  it('plays each cue\'s clips once audio is up, and nothing after dispose', () => {
    h.ctx = {};
    const s = createShopSounds();
    s.pickUp();
    expect(h.clips.map((c) => c.clip)).toEqual(SHOP_CUES.pickUp!.map((c) => c.clip));
    h.clips.length = 0;
    s.play();
    expect(h.clips.map((c) => c.clip)).toEqual(['fx/pack-drop', 'fx/whoosh-03']);
    h.clips.length = 0;
    s.dispose();
    callAll(s);
    expect(h.clips).toHaveLength(0);
  });
});
