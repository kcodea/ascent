/**
 * HERO SELECT CEREMONY — launch controller seam tests (blueprint §7, §21).
 *
 * The component chain (curtain cover → pickHero → reveal) needs a DOM; this seam does not — so the unit
 * tests pin the contract the components rely on: exactly-once launch while in flight, safe no-op with no
 * curtain registered, and a rejecting controller never propagating.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerLaunchController,
  requestLaunch,
  resetLaunchControllerForTests,
  type HeroLaunchRequest,
} from './heroLaunchController';

const REQ: HeroLaunchRequest = { heroId: 'warden', accent: 'var(--acc)' };

beforeEach(() => {
  resetLaunchControllerForTests();
});

describe('heroLaunchController', () => {
  it('runs a registered controller with the request and resolves when it does', async () => {
    const launch = vi.fn(async (req: HeroLaunchRequest) => {
      expect(req).toEqual(REQ);
    });
    registerLaunchController(launch);
    await requestLaunch(REQ);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith(REQ);
  });

  it('is a safe resolved no-op when no curtain is registered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(requestLaunch(REQ)).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('joins an in-flight launch instead of running the pickHero path twice', async () => {
    // The fake stands in for the curtain's cover→pickHero→reveal chain: it stays pending until we
    // release it, exactly like a real cover animation, so the double-press window is real.
    let release!: () => void;
    const picked = vi.fn();
    const launch = vi.fn(
      () => new Promise<void>((resolve) => { release = () => { picked(); resolve(); }; }),
    );
    registerLaunchController(launch);

    const first = requestLaunch(REQ);
    const second = requestLaunch(REQ); // double-press while covered
    expect(launch).toHaveBeenCalledTimes(1);
    expect(second).toBe(first); // the repeat press joins, it does not re-launch

    release();
    await first;
    expect(picked).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh launch after the previous one completes (new run after game over)', async () => {
    const launch = vi.fn(async () => {});
    registerLaunchController(launch);
    await requestLaunch(REQ);
    await requestLaunch({ heroId: 'aster', accent: 'var(--acc)' });
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('swallows a rejecting controller (resolves, never throws) and clears the in-flight slot', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerLaunchController(() => Promise.reject(new Error('boom')));
    await expect(requestLaunch(REQ)).resolves.toBeUndefined();

    // The failed launch must not wedge the seam: a retry runs the controller again.
    const ok = vi.fn(async () => {});
    registerLaunchController(ok);
    await requestLaunch(REQ);
    expect(ok).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('unregistering (null) returns the seam to the safe no-op state', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const launch = vi.fn(async () => {});
    registerLaunchController(launch);
    registerLaunchController(null);
    await requestLaunch(REQ);
    expect(launch).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
