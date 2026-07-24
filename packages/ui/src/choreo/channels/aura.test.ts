import { afterEach, describe, expect, it, vi } from 'vitest';
import { pixiFx } from '../../pixiFx';
import { sfx } from '../../sfx';
import { burstDeathAuras, breakShieldAura, reformReborn } from './aura';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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

  it('a Warded unit shatters gold (shield) at the rect + shieldBreak sound', () => {
    stubCard('dscard');
    const shatter = vi.spyOn(pixiFx, 'shatterAt').mockImplementation(() => {});
    const shieldSfx = vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    const reborn = vi.spyOn(sfx, 'rebornShatter').mockImplementation(() => {});
    burstDeathAuras('u1', RECT);
    expect(shatter).toHaveBeenCalledWith(200, 150, 80, 100, 'shield');
    expect(shieldSfx).toHaveBeenCalledTimes(1);
    expect(reborn).not.toHaveBeenCalled();
  });

  it('a unit carrying BOTH auras bursts each once', () => {
    stubCard('dscard', 'reborncard');
    const shatter = vi.spyOn(pixiFx, 'shatterAt').mockImplementation(() => {});
    vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    vi.spyOn(sfx, 'rebornShatter').mockImplementation(() => {});
    burstDeathAuras('u1', RECT);
    expect(shatter).toHaveBeenCalledWith(200, 150, 80, 100, 'shield');
    expect(shatter).toHaveBeenCalledWith(200, 150, 80, 100, 'reborn');
    expect(shatter).toHaveBeenCalledTimes(2);
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
  it('shatters the consumed ward at the given rect (gold shards) + sound — no Pixi bubble needed', () => {
    const shatter = vi.spyOn(pixiFx, 'shatterAt').mockImplementation(() => {});
    const s = vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    breakShieldAura({ cx: 200, cy: 150, w: 80, h: 100 });
    expect(shatter).toHaveBeenCalledWith(200, 150, 80, 100, 'shield');
    expect(s).toHaveBeenCalledTimes(1);
  });

  it('with no rect (unit not measurable) plays only the sound', () => {
    const shatter = vi.spyOn(pixiFx, 'shatterAt').mockImplementation(() => {});
    const s = vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    breakShieldAura(null);
    expect(shatter).not.toHaveBeenCalled();
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
