import { afterEach, describe, expect, it, vi } from 'vitest';
import { pixiFx } from '../../pixiFx';
import { sfx } from '../../sfx';
// The Ward-loss burst is the owner-authored `ward-lost-blast` def, fired through `playDef` (2026-09-09,
// replacing the old `shatterAt('shield')` gold-shard burst; the sound is unchanged). Mock at the MODULE —
// `playDef` is a bare function export — so these assertions check WHICH def fired and where, like impact.test.
vi.mock('../../fx/playDef', () => ({ playDef: vi.fn(() => null) }));
import { playDef } from '../../fx/playDef';
import { burstDeathAuras, breakShieldAura, reformReborn } from './aura';

const playDefMock = vi.mocked(playDef);

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); playDefMock.mockClear(); });

// The suite runs in bare Node (no jsdom — see vitest.config.ts), so stub the single `document.querySelector`
// call the aura channel makes: return a card whose classList carries the given marker classes, or null.
const stubCard = (...classes: string[]): void => {
  const card = { classList: { contains: (c: string) => classes.includes(c) } };
  vi.stubGlobal('document', { querySelector: () => card });
};
const stubNoCard = (): void => { vi.stubGlobal('document', { querySelector: () => null }); };
const RECT = { cx: 200, cy: 150, w: 80, h: 100 };

describe('burstDeathAuras', () => {
  it('a Reborn unit releases its spirit (wispy shatter at the rect) + rebornShatter sound', () => {
    stubCard('reborncard');
    const shatter = vi.spyOn(pixiFx, 'shatterAt').mockImplementation(() => {});
    const reborn = vi.spyOn(sfx, 'rebornShatter').mockImplementation(() => {});
    const shieldSfx = vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    burstDeathAuras('u1', RECT);
    expect(shatter).toHaveBeenCalledWith(200, 150, 80, 100, 'reborn');
    expect(reborn).toHaveBeenCalledTimes(1);
    expect(shieldSfx).not.toHaveBeenCalled(); // no ward marker → no gold-break sound
  });

  it('a Warded unit bursts ward-lost-blast at the rect + shieldBreak sound', () => {
    stubCard('dscard');
    const shatter = vi.spyOn(pixiFx, 'shatterAt').mockImplementation(() => {});
    const shieldSfx = vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    const reborn = vi.spyOn(sfx, 'rebornShatter').mockImplementation(() => {});
    burstDeathAuras('u1', RECT);
    expect(playDefMock).toHaveBeenCalledWith('ward-lost-blast', { target: { x: 200, y: 150 } }, { uids: { source: null, target: 'u1' } });
    expect(shatter).not.toHaveBeenCalledWith(200, 150, 80, 100, 'shield'); // the shard-burst was replaced by the def
    expect(shieldSfx).toHaveBeenCalledTimes(1);
    expect(reborn).not.toHaveBeenCalled();
  });

  it('a unit carrying BOTH auras bursts each once — ward via the def, reborn via the shatter', () => {
    stubCard('dscard', 'reborncard');
    const shatter = vi.spyOn(pixiFx, 'shatterAt').mockImplementation(() => {});
    vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    vi.spyOn(sfx, 'rebornShatter').mockImplementation(() => {});
    burstDeathAuras('u1', RECT);
    expect(playDefMock).toHaveBeenCalledWith('ward-lost-blast', { target: { x: 200, y: 150 } }, { uids: { source: null, target: 'u1' } });
    expect(playDefMock).toHaveBeenCalledTimes(1);
    expect(shatter).toHaveBeenCalledWith(200, 150, 80, 100, 'reborn');
    expect(shatter).toHaveBeenCalledTimes(1);
  });

  it('a unit carrying no aura marker bursts nothing', () => {
    stubNoCard();
    const shatter = vi.spyOn(pixiFx, 'shatterAt').mockImplementation(() => {});
    burstDeathAuras('u2', RECT);
    expect(shatter).not.toHaveBeenCalled();
  });

  it('with no rect (unit not measurable) bursts nothing', () => {
    stubCard('reborncard'); // marker present, but no rect to anchor the burst
    const shatter = vi.spyOn(pixiFx, 'shatterAt').mockImplementation(() => {});
    burstDeathAuras('u1', null);
    expect(shatter).not.toHaveBeenCalled();
  });
});

describe('breakShieldAura', () => {
  it('bursts ward-lost-blast at the given rect, carrying the losing unit uid + sound — no Pixi bubble needed', () => {
    const s = vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    breakShieldAura({ cx: 200, cy: 150, w: 80, h: 100 }, 'u7');
    expect(playDefMock).toHaveBeenCalledWith('ward-lost-blast', { target: { x: 200, y: 150 } }, { uids: { source: null, target: 'u7' } });
    expect(s).toHaveBeenCalledTimes(1);
  });

  it('with no rect (unit not measurable) plays only the sound', () => {
    const s = vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    breakShieldAura(null, 'u7');
    expect(playDefMock).not.toHaveBeenCalled();
    expect(s).toHaveBeenCalledTimes(1);
  });
});

describe('reformReborn', () => {
  it('plays the re-form glow + sound immediately, positioned via the rect — the delay now lives in the cue offset', () => {
    const summon = vi.spyOn(pixiFx, 'rebornSummon').mockImplementation(() => {});
    const s = vi.spyOn(sfx, 'rebornSummon').mockImplementation(() => {});
    reformReborn({ cx: 5, cy: 6, w: 7, h: 8 });
    expect(summon).toHaveBeenCalledWith(5, 6, 7, 8);
    expect(s).toHaveBeenCalledTimes(1);
  });

  it('with no rect (unit not measurable) plays only the sound', () => {
    const summon = vi.spyOn(pixiFx, 'rebornSummon').mockImplementation(() => {});
    const s = vi.spyOn(sfx, 'rebornSummon').mockImplementation(() => {});
    reformReborn(null);
    expect(summon).not.toHaveBeenCalled();
    expect(s).toHaveBeenCalledTimes(1);
  });
});
