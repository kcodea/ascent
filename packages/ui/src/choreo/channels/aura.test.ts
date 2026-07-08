import { afterEach, describe, expect, it, vi } from 'vitest';
import { pixiFx, tauntFx } from '../../pixiFx';
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
    expect(shieldSfx).not.toHaveBeenCalled(); // no shield/taunt aura → no gold-break sound
  });

  it('a unit carrying no aura bursts nothing', () => {
    vi.spyOn(pixiFx, 'hasAura').mockReturnValue(false);
    vi.spyOn(tauntFx, 'hasAura').mockReturnValue(false);
    const brk = vi.spyOn(pixiFx, 'breakShield').mockImplementation(() => {});
    burstDeathAuras('u2');
    expect(brk).not.toHaveBeenCalled();
  });

  it('a taunt carrier bursts in FRONT at the passed VIEWPORT rect (not the back-layer bubble coords)', () => {
    vi.spyOn(pixiFx, 'hasAura').mockReturnValue(false); // no front-layer auras
    vi.spyOn(tauntFx, 'hasAura').mockImplementation((_uid, kind) => kind === 'taunt');
    const clear = vi.spyOn(tauntFx, 'clearShield').mockImplementation(() => {});
    const burst = vi.spyOn(pixiFx, 'tauntBurst').mockImplementation(() => {});
    const s = vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    burstDeathAuras('t1', { cx: 100, cy: 200, w: 40, h: 60 });
    expect(clear).toHaveBeenCalledWith('t1', 'taunt'); // back-canvas bulwark dropped…
    expect(burst).toHaveBeenCalledWith(100, 200, 40, 60); // …burst at the passed viewport coords
    expect(s).toHaveBeenCalledTimes(1);
  });

  it('a taunt carrier with no rect drops the bulwark + sounds but draws no misplaced burst', () => {
    vi.spyOn(pixiFx, 'hasAura').mockReturnValue(false);
    vi.spyOn(tauntFx, 'hasAura').mockImplementation((_uid, kind) => kind === 'taunt');
    vi.spyOn(tauntFx, 'clearShield').mockImplementation(() => {});
    const burst = vi.spyOn(pixiFx, 'tauntBurst').mockImplementation(() => {});
    const s = vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    burstDeathAuras('t2', null);
    expect(burst).not.toHaveBeenCalled();
    expect(s).toHaveBeenCalledTimes(1);
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
