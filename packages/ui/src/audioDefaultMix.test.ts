// @vitest-environment jsdom
/**
 * THE DEFAULT MIX on a cold load (owner ask 2026-09-24: "bake these audio values as the default volumes, but all at
 * the 50 mark for volume"). Every Settings Audio slider starts at 50, and 50 plays the owner's mix (Game sounds 0.5,
 * Music 0.2, Announcer 0.7). A player's OLD saved values (raw gains under the pre-curve keys) are not read: everyone
 * starts once on the new defaults, and a choice made after that sticks. Mutes are untouched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function coldLoad() {
  vi.resetModules();
  const sfx = await import('./sfx');
  const music = await import('./music');
  const announcer = await import('./announcer');
  return { sfx, music, announcer };
}

beforeEach(() => { localStorage.clear(); });

describe('the default mix', () => {
  it('a fresh player: all three sliders at 50, playing 0.5 / 0.2 / 0.7', async () => {
    const { sfx, music, announcer } = await coldLoad();
    expect(sfx.getVolume()).toBe(0.5);
    expect(music.getMusicVolume()).toBe(0.5);
    expect(announcer.getAnnouncerVolume()).toBe(0.5);
    expect(music.musicDebug().level).toBeCloseTo(0.2, 10);
    expect(announcer.announcerDebug().level).toBeCloseTo(0.7, 10);
  });

  it('old saved values reset ONCE to the new defaults; the mixer desk and the mutes are kept', async () => {
    localStorage.setItem('ascent.musicvol', '0.9');
    localStorage.setItem('ascent.announcervol', '0.3');
    localStorage.setItem('ascent.audiocfg', JSON.stringify({ masterGain: 0.8, categories: { buy: { bus: 'ui', gain: 0.42 } } }));
    localStorage.setItem('ascent.musicmuted', '1');
    let { sfx, music, announcer } = await coldLoad();
    expect(sfx.getVolume()).toBe(0.5);
    expect(music.getMusicVolume()).toBe(0.5);
    expect(announcer.getAnnouncerVolume()).toBe(0.5);
    expect(music.isMusicMuted()).toBe(true);
    expect(JSON.parse(localStorage.getItem('ascent.audiocfg')!)).toEqual({ categories: { buy: { bus: 'ui', gain: 0.42 } } });
    expect(sfx.getSampleVolumes().buy).toBe(0.42);

    // A choice made after the reset sticks across the next load.
    sfx.setVolume(0.3);
    music.setMusicVolume(0.7);
    announcer.setAnnouncerVolume(0.2);
    ({ sfx, music, announcer } = await coldLoad());
    expect(sfx.getVolume()).toBe(0.3);
    expect(music.getMusicVolume()).toBe(0.7);
    expect(announcer.getAnnouncerVolume()).toBe(0.2);
  });

  it('storage that throws falls back to the defaults', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      const { sfx, music, announcer } = await coldLoad();
      expect(sfx.getVolume()).toBe(0.5);
      expect(music.getMusicVolume()).toBe(0.5);
      expect(announcer.getAnnouncerVolume()).toBe(0.5);
    } finally {
      get.mockRestore();
    }
  });
});
