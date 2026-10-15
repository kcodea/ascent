import { describe, expect, it } from 'vitest';
import { displaySeconds, ServerClock } from './versusClock';

describe('Versus server clock', () => {
  it('estimates the offset from the lowest-latency sample', () => {
    const c = new ServerClock();
    // Server is 5 s ahead. A slow sample (rtt 800) is noisier than a fast one (rtt 40).
    c.sample(1000, 1800, new Date(1000 + 400 + 5000 + 300).toISOString());
    c.sample(2000, 2040, new Date(2020 + 5000).toISOString());
    expect(c.offset()).toBe(5000);
    expect(c.remainingMs(new Date(10_000 + 5000).toISOString(), 4000)).toBe(6000);
  });
  it('ignores bad samples and shows whole seconds, never negative', () => {
    const c = new ServerClock();
    c.sample(10, 5, new Date().toISOString());
    c.sample(10, 20, 'nope');
    expect(c.offset()).toBe(0);
    expect(displaySeconds(1)).toBe(1);
    expect(displaySeconds(1000)).toBe(1);
    expect(displaySeconds(1001)).toBe(2);
    expect(displaySeconds(-50)).toBe(0);
    expect(displaySeconds(null)).toBe(0);
  });
});
