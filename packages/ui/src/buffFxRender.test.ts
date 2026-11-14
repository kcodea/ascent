import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./fx/playDef', () => ({ playDef: vi.fn(() => null) }));
import { playDef } from './fx/playDef';
import runeBuffTrail from './fx/defs/rune-buff-trail.json';
import { fireBuffFx } from './buffFxRender';

const mockPlayDef = playDef as unknown as ReturnType<typeof vi.fn>;

describe('fireBuffFx', () => {
  beforeEach(() => mockPlayDef.mockClear());

  it("with a living source → plays the buffer TRIBE's ribbon variant source→target, handing over both uids", () => {
    fireBuffFx({
      source: { x: 0, y: 0 }, target: { x: 5, y: 5 }, cardId: 'x', tribe: 'beast', sourceless: false,
      uids: { source: 'buffer', target: 'buffed' },
    });
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    expect(mockPlayDef).toHaveBeenCalledWith(
      'tendril-trail-beast',
      { source: { x: 0, y: 0 }, target: { x: 5, y: 5 } },
      { uids: { source: 'buffer', target: 'buffed' } },
    );
  });

  it('a tribe with no variant (neutral) falls back to the generic rune-buff-trail', () => {
    fireBuffFx({ source: { x: 0, y: 0 }, target: { x: 5, y: 5 }, cardId: 'x', tribe: 'neutral', sourceless: false });
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    expect(mockPlayDef).toHaveBeenCalledWith('rune-buff-trail', expect.anything(), expect.anything());
  });

  // The roll lands when the ribbon arrives, so the returned time must track the DEF's own travel — retuning
  // `travelMs` in the workbench moves the roll with it. Read the same way the renderer reads it.
  it("returns the ribbon layer's travelMs from the def, so the stat roll lands on arrival", () => {
    const ms = fireBuffFx({ source: { x: 0, y: 0 }, target: { x: 5, y: 5 }, cardId: 'x', tribe: 'beast', sourceless: false });
    const ribbon = runeBuffTrail.layers.find((l) => l.primitive === 'ribbon');
    expect(ribbon?.travelMs).toBeGreaterThan(0);
    expect(ms).toBe(ribbon?.travelMs);
  });

  // No sourceless (descend) replacement is authored yet: it draws nothing but keeps the old drop time so the
  // badge still rolls on the same clock.
  it('sourceless → plays nothing and returns the descend drop time', () => {
    const ms = fireBuffFx({ target: { x: 10, y: 20 }, cardId: 'x', tribe: 'neutral', sourceless: true });
    expect(mockPlayDef).not.toHaveBeenCalled();
    expect(ms).toBeGreaterThan(0);
  });
});

describe('playRuneBuffTrail: the sound does not stack', () => {
  beforeEach(() => mockPlayDef.mockClear());

  it('a burst of trails in one moment sounds once; the rest are muted', async () => {
    const { playRuneBuffTrail, runeBuffTrailSoundAllowed } = await import('./buffFxRender');
    const far = performance.now() + 60_000;
    expect(runeBuffTrailSoundAllowed(far)).toBe(true);        // opens a fresh window
    expect(runeBuffTrailSoundAllowed(far + 1)).toBe(false);   // inside the gap
    expect(runeBuffTrailSoundAllowed(far + 5_000)).toBe(true); // a later trail rings again
    const clock = vi.spyOn(performance, 'now').mockReturnValue(far + 20_000);
    for (let i = 0; i < 7; i++) playRuneBuffTrail({ x: 0, y: 0 }, { x: i, y: 5 });
    clock.mockRestore();
    const muted = mockPlayDef.mock.calls.map((c) => (c[2] as { muteSound?: boolean }).muteSound === true);
    expect(muted).toEqual([false, true, true, true, true, true, true]);
  });
});
