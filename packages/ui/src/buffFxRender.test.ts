import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./fx/playDef', () => ({ playDef: vi.fn(() => null) }));
import { playDef } from './fx/playDef';
import tendrilTrail from './fx/defs/tendril-trail.json';
import { fireBuffFx } from './buffFxRender';

const mockPlayDef = playDef as unknown as ReturnType<typeof vi.fn>;

describe('fireBuffFx', () => {
  beforeEach(() => mockPlayDef.mockClear());

  it('with a living source → plays the tendril-trail ribbon source→target, handing over both uids', () => {
    fireBuffFx({
      source: { x: 0, y: 0 }, target: { x: 5, y: 5 }, cardId: 'x', tribe: 'beast', sourceless: false,
      uids: { source: 'buffer', target: 'buffed' },
    });
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    expect(mockPlayDef).toHaveBeenCalledWith(
      'tendril-trail',
      { source: { x: 0, y: 0 }, target: { x: 5, y: 5 } },
      { uids: { source: 'buffer', target: 'buffed' } },
    );
  });

  // The roll lands when the ribbon arrives, so the returned time must track the DEF's own travel — retuning
  // `travelMs` in the workbench moves the roll with it. Read the same way the renderer reads it.
  it("returns the ribbon layer's travelMs from the def, so the stat roll lands on arrival", () => {
    const ms = fireBuffFx({ source: { x: 0, y: 0 }, target: { x: 5, y: 5 }, cardId: 'x', tribe: 'beast', sourceless: false });
    const ribbon = tendrilTrail.layers.find((l) => l.primitive === 'ribbon');
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
