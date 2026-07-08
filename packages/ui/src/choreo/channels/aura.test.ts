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
    expect(shieldSfx).not.toHaveBeenCalled(); // no shield/taunt aura → no gold-break sound
  });

  it('a unit carrying no aura bursts nothing', () => {
    vi.spyOn(pixiFx, 'hasAura').mockReturnValue(false);
    const brk = vi.spyOn(pixiFx, 'breakShield').mockImplementation(() => {});
    burstDeathAuras('u2');
    expect(brk).not.toHaveBeenCalled();
  });
});

describe('breakShieldAura', () => {
  it('holds the consumed shield, then shatters + sounds after shieldBreakDelay/combatSpeed', () => {
    vi.useFakeTimers();
    const brk = vi.spyOn(pixiFx, 'breakShield').mockImplementation(() => {});
    const s = vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    const cancel = breakShieldAura('u3', 2); // combatSpeed 2 → 150ms
    expect(brk).not.toHaveBeenCalled();
    vi.advanceTimersByTime(149);
    expect(brk).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(brk).toHaveBeenCalledWith('u3', 'shield');
    expect(s).toHaveBeenCalledTimes(1);
    cancel(); // no throw after fire
  });

  it('the returned cancel prevents a pending shatter', () => {
    vi.useFakeTimers();
    const brk = vi.spyOn(pixiFx, 'breakShield').mockImplementation(() => {});
    const cancel = breakShieldAura('u4', 1);
    cancel();
    vi.advanceTimersByTime(1000);
    expect(brk).not.toHaveBeenCalled();
  });
});

describe('reformReborn', () => {
  it('schedules the re-form glow + sound at rebornReformDelay/combatSpeed, positioned via the passed rect', () => {
    vi.useFakeTimers();
    const summon = vi.spyOn(pixiFx, 'rebornSummon').mockImplementation(() => {});
    const s = vi.spyOn(sfx, 'rebornSummon').mockImplementation(() => {});
    reformReborn({ cx: 5, cy: 6, w: 7, h: 8 }, 1); // combatSpeed 1 → 460ms
    vi.advanceTimersByTime(459);
    expect(summon).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(summon).toHaveBeenCalledWith(5, 6, 7, 8);
    expect(s).toHaveBeenCalledTimes(1);
  });

  it('with no rect (unit not measurable) plays only the sound', () => {
    vi.useFakeTimers();
    const summon = vi.spyOn(pixiFx, 'rebornSummon').mockImplementation(() => {});
    const s = vi.spyOn(sfx, 'rebornSummon').mockImplementation(() => {});
    reformReborn(null, 1);
    vi.advanceTimersByTime(500);
    expect(summon).not.toHaveBeenCalled();
    expect(s).toHaveBeenCalledTimes(1);
  });
});
