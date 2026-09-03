import { describe, it, expect, vi } from 'vitest';

// The generic tendril/descend VISUALS were stripped 2026-09-02 (owner ask) — `fireBuffFx` no longer imports or
// calls `pixiFx`. The mock stays as a regression guard: if a draw is ever re-added here, these assertions fail.
vi.mock('./pixiFx', () => ({ pixiFx: { descend: vi.fn(), buffTendril: vi.fn() } }));
import { pixiFx } from './pixiFx';
import { fireBuffFx } from './buffFxRender';

describe('fireBuffFx (timing only — generic visual removed 2026-09-02)', () => {
  it('sourceless → returns dropMs and draws nothing', () => {
    const ms = fireBuffFx({ target: { x: 10, y: 20 }, cardId: 'x', tribe: 'neutral', sourceless: true });
    expect(ms).toBeGreaterThan(0); // the stat-badge roll still rides this flight time
    expect((pixiFx.descend as any)).not.toHaveBeenCalled();
    expect((pixiFx.buffTendril as any)).not.toHaveBeenCalled();
  });
  it('with a source → returns travelMs and draws nothing', () => {
    const ms = fireBuffFx({ source: { x: 0, y: 0 }, target: { x: 5, y: 5 }, cardId: 'x', tribe: 'beast', sourceless: false });
    expect(ms).toBeGreaterThan(0);
    expect((pixiFx.buffTendril as any)).not.toHaveBeenCalled();
    expect((pixiFx.descend as any)).not.toHaveBeenCalled();
  });
});
