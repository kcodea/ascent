import { describe, it, expect, vi } from 'vitest';

vi.mock('./pixiFx', () => ({ pixiFx: { descend: vi.fn(), buffTendril: vi.fn() } }));
import { pixiFx } from './pixiFx';
import { fireBuffFx } from './buffFxRender';

describe('fireBuffFx', () => {
  it('sourceless → descend at the target, returns dropMs', () => {
    const ms = fireBuffFx({ target: { x: 10, y: 20 }, cardId: 'x', tribe: 'neutral', sourceless: true });
    expect((pixiFx.descend as any)).toHaveBeenCalledWith(10, 20, expect.anything());
    expect(ms).toBeGreaterThan(0);
  });
  it('with a source → tendril source→target, returns travelMs', () => {
    const ms = fireBuffFx({ source: { x: 0, y: 0 }, target: { x: 5, y: 5 }, cardId: 'x', tribe: 'beast', sourceless: false });
    expect((pixiFx.buffTendril as any)).toHaveBeenCalledWith({ x: 0, y: 0 }, { x: 5, y: 5 }, expect.anything());
    expect(ms).toBeGreaterThan(0);
  });
});
