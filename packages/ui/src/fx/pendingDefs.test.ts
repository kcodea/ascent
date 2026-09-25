import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredFxDef } from './defStore';

// A fresh module per test (its state lives at module scope), over a hand-rolled localStorage (no jsdom here).
function stubStorage(seed: Record<string, string> = {}): Record<string, string> {
  const store = { ...seed };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
  return store;
}
const sound = (id: string): StoredFxDef => ({ version: 1, id, duration: 1000, layers: [{ primitive: 'sound', anchor: 'travel', at: 0, params: { clip: `fx/${id}` } }] } as StoredFxDef);

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('pendingDefs — imported sound defs wait for "Save all edits" (owner 2026-09-25)', () => {
  it('parks a def, registers it so it plays now, and clears it once saved', async () => {
    stubStorage();
    const m = await import('./pendingDefs');
    const { getDef } = await import('./fxDefs');
    m.addPendingDef(sound('sfx-test-growl'));
    expect(m.hasPendingDefs()).toBe(true);
    expect(getDef('sfx-test-growl')?.id).toBe('sfx-test-growl');
    m.clearPendingDefs(['sfx-test-growl']);
    expect(m.hasPendingDefs()).toBe(false);
  });

  it('survives a reload: a parked def comes back (and plays) from localStorage', async () => {
    const store = stubStorage();
    const first = await import('./pendingDefs');
    first.addPendingDef(sound('sfx-test-roar'));
    vi.resetModules();
    stubStorage(store);
    const again = await import('./pendingDefs');
    const { getDef } = await import('./fxDefs');
    expect(again.pendingDefs().map((d) => d.id)).toEqual(['sfx-test-roar']);
    expect(getDef('sfx-test-roar')).toBeDefined();
  });

  it('a corrupt blob degrades to nothing pending', async () => {
    stubStorage({ 'ascent.fx.pendingDefs': '{not json' });
    const m = await import('./pendingDefs');
    expect(m.hasPendingDefs()).toBe(false);
  });
});
