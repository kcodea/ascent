import { describe, expect, it } from 'vitest';
import { bubbleShape } from './chatBubbleShape';

// A long message's later bubble (owner 2026-11-09: "a specific tail for when a long message is sent, so it looks like it
// comes from the same spot"): its tail's tip lands exactly where it was aimed, the first bubble's tip, however the box leans.
const opts = { w: 250, h: 98, wobble: 0.4, radius: 20, tailLen: 18, accents: 0, accentGap: 8, askew: 3 };

describe('the reaching tail', () => {
  it('lands its tip exactly on the aimed point, on either side, for every variant', () => {
    for (let seed = 0; seed < 8; seed++) {
      const l = bubbleShape({ ...opts, tail: 'left', seed, reach: { x: -22, y: -40 } });
      expect(l.tip).toEqual({ x: -22, y: -40 });
      expect(l.body).toContain('-22.0,-40.0');
      const r = bubbleShape({ ...opts, tail: 'right', seed, reach: { x: opts.w + 22, y: -40 } });
      expect(r.tip).toEqual({ x: opts.w + 22, y: -40 });
    }
  });

  it('a first bubble reports where its own tip went (the later bubbles aim at it)', () => {
    const s = bubbleShape({ ...opts, tail: 'left', seed: 3 });
    expect(s.tip).not.toBeNull();
    expect(s.tip!.x).toBeLessThan(0);
  });

  it('an aim on the wrong side of the bubble falls back to the usual short tail', () => {
    const s = bubbleShape({ ...opts, tail: 'left', seed: 3, reach: { x: 40, y: -40 } });
    expect(s.tip!.y).toBeGreaterThan(0);
  });
});
