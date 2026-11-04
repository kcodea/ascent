import { describe, expect, it, vi } from 'vitest';

vi.mock('./artPreload', () => ({ artMemoryStats: () => ({}), artQueueStats: () => ({}), artState: () => 'unknown' }));
vi.mock('./store', () => ({ useGame: { getState: () => ({}) } }));

import { causeOfWait, shortName, summarize, viaOf, type PopInEvent } from './popIn';
import { popInEnabled } from './popInFlag';

/** The pop-in probe's reading of what it saw (R-PERF-ART-PLAN-COMPLETE-01). The DOM half is exercised by `npm run perf:popin`. */
describe('pop-in probe', () => {
  it('names a file without its build hash', () => {
    expect(shortName('/assets/oval-beast-Ab12cD_e.webp')).toBe('oval-beast');
    expect(shortName('./frames/tier-stars-3.webp?retry=1-abc')).toBe('tier-stars-3');
  });

  it('reads where the bytes came from out of Resource Timing', () => {
    expect(viaOf({ transferSize: 90000, encodedBodySize: 89000 })).toBe('network');
    expect(viaOf({ transferSize: 300, encodedBodySize: 89000 })).toBe('revalidate');
    expect(viaOf({ transferSize: 0, encodedBodySize: 89000 })).toBe('disk');
    expect(viaOf({ transferSize: 0, encodedBodySize: 0 })).toBe('async');
    expect(viaOf(undefined)).toBe('async');
  });

  it('blames the plan before the network: a missing plan entry is the fix', () => {
    expect(causeOfWait('unknown', 'network')).toBe('not-in-plan');
    expect(causeOfWait('pending', 'network')).toBe('pipe-pending');
    expect(causeOfWait('ready', 'revalidate')).toBe('revalidate');
  });

  it('counts what was on screen, per cause and per screen, worst first', () => {
    const e = (over: Partial<PopInEvent>): PopInEvent => ({ url: '/a.webp', name: 'a', kind: 'img', screen: 'shop r2', at: 0, cause: 'network', waitMs: 10, seen: true, ...over });
    const s = summarize([e({}), e({ waitMs: 40 }), e({ url: '/b.webp', name: 'b', cause: 'redecode', screen: 'combat r2', waitMs: 9 }), e({ seen: false, cause: 'disk' })]);
    expect(s.total).toBe(3);
    expect(s.byCause).toEqual({ network: 2, redecode: 1 });
    expect(s.byScreen).toEqual({ shop: 2, combat: 1 });
    expect(s.top[0]).toMatchObject({ name: 'a', n: 2, worstMs: 40 });
  });

  it('is off unless asked for', () => {
    expect(popInEnabled()).toBe(false);
  });
});
