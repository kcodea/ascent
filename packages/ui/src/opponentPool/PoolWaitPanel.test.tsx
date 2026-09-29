// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import { createPoolGate } from './poolGate';
import type { PoolLoader, PoolLoadState } from './poolLoader';
import { PoolWaitPanel } from './PoolWaitPanel';

/** The lobby pool gate's panel (fix 2026-09-28): a wait says so, and an unreachable pool asks, never falls
 *  back silently. */
let m: Mounted | null = null;
afterEach(() => { m?.unmount(); m = null; });

const state = (status: PoolLoadState['status']): PoolLoadState =>
  ({ status, source: 'none', wavesFresh: 0, wavesFromCache: 0, wavesTotal: 17, boards: 0 });

/** A loader whose `ensure()` the test resolves by hand. */
function stubLoader(): PoolLoader & { resolve(s: PoolLoadState): void } {
  let resolve!: (s: PoolLoadState) => void;
  let pending = new Promise<PoolLoadState>((r) => { resolve = r; });
  return {
    state: () => state('loading'),
    subscribe: () => () => {},
    load: () => pending,
    ensure: () => pending,
    onOnline: () => {},
    dispose: () => {},
    resolve(s) { resolve(s); pending = new Promise<PoolLoadState>((r) => { resolve = r; }); },
  };
}

describe('the Finding opponents panel', () => {
  it('shows nothing when the gate is idle', () => {
    m = mount(<PoolWaitPanel gate={createPoolGate(() => null)} />);
    expect(m.container.textContent).toBe('');
  });

  it('shows "Finding opponents" with Cancel while waiting', () => {
    const gate = createPoolGate(() => stubLoader());
    m = mount(<PoolWaitPanel gate={gate} />);
    act(() => { void gate.run(); });
    expect(m.container.textContent).toContain('Finding opponents');
    expect(m.container.querySelector('button')?.textContent).toBe('Cancel');
    act(() => gate.cancel());
  });

  it('an unreachable pool shows the message with Retry / Play anyway / Back to menu', async () => {
    const loader = stubLoader();
    const gate = createPoolGate(() => loader);
    m = mount(<PoolWaitPanel gate={gate} />);
    let outcome: Promise<string> = Promise.resolve('');
    act(() => { outcome = gate.run(); });
    await act(async () => { loader.resolve(state('failed')); await Promise.resolve(); });
    expect(m.container.textContent).toContain("Couldn't reach other players' boards.");
    const labels = Array.from(m.container.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Retry', 'Play anyway', 'Back to menu']);
    // No em dash in player text, and no native tooltip.
    expect(m.container.textContent).not.toMatch(/—|--/);
    expect(m.container.querySelector('[title]')).toBeNull();
    act(() => { (m!.container.querySelectorAll('button')[1] as HTMLButtonElement).click(); });
    expect(await outcome).toBe('go');
    expect(m.container.textContent).toBe('');
  });
});
