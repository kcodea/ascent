import { afterEach, describe, expect, it, vi } from 'vitest';
import { pixiFx } from '../../pixiFx';
import { sfx } from '../../sfx';
import { burstDeathAuras, breakShieldAura, reformReborn } from './aura';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('burstDeathAuras', () => {
  it('bursts each aura kind the unit carries (per pixiFx.hasAura) with its sound; skips absent ones', () => {
    vi.spyOn(pixiFx, 'hasAura').mockImplementation((_uid, kind) => kind === 'reborn'); // carries only a reborn aura
    const brk = vi.spyOn(pixiFx, 'breakShield').mockImplementation(() => {});
    const shatter = vi.spyOn(sfx, 'rebornShatter').mockImplementation(() => {});
    const shieldSfx = vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    burstDeathAuras('u1');
    expect(brk).toHaveBeenCalledWith('u1', 'reborn');
    expect(shatter).toHaveBeenCalledTimes(1);
    expect(shieldSfx).not.toHaveBeenCalled(); // no shield aura → no gold-break sound
  });

  it('a unit carrying no aura bursts nothing', () => {
    vi.spyOn(pixiFx, 'hasAura').mockReturnValue(false);
    const brk = vi.spyOn(pixiFx, 'breakShield').mockImplementation(() => {});
    burstDeathAuras('u2');
    expect(brk).not.toHaveBeenCalled();
  });
});

describe('breakShieldAura', () => {
  it('shatters the consumed shield (gold shards) + sound immediately — the delay now lives in the cue offset', () => {
    const brk = vi.spyOn(pixiFx, 'breakShield').mockImplementation(() => {});
    const s = vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    breakShieldAura('u3');
    expect(brk).toHaveBeenCalledWith('u3', 'shield');
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
