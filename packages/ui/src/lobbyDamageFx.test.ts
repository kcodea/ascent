// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { whenCurtainDown } from './lobbyDamageFx';

// Owner 2026-09-24: "sometimes background elements come through the wipe". The round settles UNDER the exit
// curtain, so the lobby damage float must wait for `body.wipe-up` to clear instead of popping over the blue.
describe('whenCurtainDown', () => {
  afterEach(() => { document.body.classList.remove('wipe-up'); vi.useRealTimers(); });

  it('runs at once when no curtain is up', () => {
    const fn = vi.fn();
    whenCurtainDown(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('waits while the curtain is up and runs once it comes down', async () => {
    document.body.classList.add('wipe-up');
    const fn = vi.fn();
    whenCurtainDown(fn);
    document.body.classList.add('something-else');
    await Promise.resolve();
    expect(fn).not.toHaveBeenCalled();
    document.body.classList.remove('wipe-up');
    await new Promise((r) => setTimeout(r, 0));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled, and gives up rather than queueing forever', async () => {
    vi.useFakeTimers();
    document.body.classList.add('wipe-up');
    const a = vi.fn(), b = vi.fn();
    const cancel = whenCurtainDown(a);
    whenCurtainDown(b);
    cancel();
    vi.advanceTimersByTime(7000);
    document.body.classList.remove('wipe-up');
    await Promise.resolve();
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});
