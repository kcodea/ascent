// @vitest-environment jsdom
/**
 * A HERO PICK THAT DID NOT LAND IS SENT AGAIN (R-VERSUS-HEROPICK-RETRY-01; QA 2026-10-29 for the owner's report "both
 * players pressed ready and each said waiting on the other player, and then it eventually went through"). The card is
 * locked on screen the moment it is chosen, so a lost pick used to leave "Waiting for your opponent" up until the 20 s
 * clock ran out, and the server then picked a hero at random for that player.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const net = vi.hoisted(() => ({ fails: [] as string[], calls: 0 }));
vi.mock('./versusRemote', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./versusRemote')>();
  return {
    ...orig,
    versusRemote: {
      ...orig.versusRemote,
      pickHero: async () => {
        net.calls++;
        const code = net.fails.shift();
        if (code) throw new orig.VersusError(code);
        const { useVersus } = await import('./versusStore');
        return useVersus.getState().match;
      },
    },
  };
});

const { useVersus, pickVersusHero, HERO_PICK_RETRIES } = await import('./versusStore');

const settle = async (ms: number): Promise<void> => { for (let t = 0; t < ms; t += 100) { await vi.advanceTimersByTimeAsync(100); } };

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(net, { fails: [], calls: 0 });
  useVersus.setState({ match: { id: 'm1', phase: 'hero_select', round: 0, revision: 1 }, priv: { match_id: 'm1', hero_index: null }, error: null } as never);
});
afterEach(() => { useVersus.setState({ match: null, priv: null, error: null } as never); vi.useRealTimers(); });

describe('R-VERSUS-HEROPICK-RETRY-01', () => {
  it('a pick lost to a timeout or a refused request is sent again until it lands', async () => {
    net.fails = ['timeout', 'rate_limited'];
    const done = pickVersusHero(1);
    await settle(4000);
    await done;
    expect(net.calls).toBe(3);
  });

  it('never more than the cap, and never once the server says the pick cannot land', async () => {
    net.fails = Array(10).fill('network');
    const a = pickVersusHero(1);
    await settle(20_000);
    await a;
    expect(net.calls).toBe(HERO_PICK_RETRIES + 1);
    net.calls = 0;
    net.fails = ['hero_deadline_passed', 'timeout'];
    await pickVersusHero(1);
    expect(net.calls).toBe(1);
  });

  it('stops as soon as Hero Select is over (the clock picked, or the match moved on)', async () => {
    net.fails = ['timeout', 'timeout', 'timeout'];
    const a = pickVersusHero(1);
    await vi.advanceTimersByTimeAsync(10);
    useVersus.setState({ match: { id: 'm1', phase: 'shop', round: 1, revision: 2 } } as never);
    await settle(5000);
    await a;
    expect(net.calls).toBe(1);
  });
});
