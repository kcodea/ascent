/**
 * R-REPLAY-STREAM-01: the replay's spectator stream stores every cursor message exactly as the live sender built it
 * (minus the legacy window fractions), compactly. Pinned here: the round trip is exact for every message shape the
 * sender makes (moves, anchored points, trails with anchored points, a held card with its drop gap, an aim, a hide, a
 * drop outcome), held card / aim are stored only on change, the caps drop only position-only messages, events round
 * trip, and a shift moves only the clock.
 */
import { describe, expect, it } from 'vitest';
import {
  EV_OVERLAY, EV_SKIP, STREAM_SEG_MAX_MSGS, decodeStreamEvents, decodeStreamSegment, encodeStreamEvent, encodeStreamMessage,
  isReplayStream, newStreamEncoder, overlayBitsOf, packInts, sealStreamSegment, shiftStreamSegment, unpackInts, type StreamCursorBody,
} from './replayStream';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const strip = (b: StreamCursorBody): Omit<StreamCursorBody, 'x' | 'y'> => { const { x: _x, y: _y, ...rest } = b; void _x; void _y; return rest; };

/** A realistic message sequence: hover, pick up, drag with a gap, a refused drop, an aim, a hide. */
function messages(): StreamCursorBody[] {
  const held = { uid: 'u7', source: 'shop', cardId: 'b1_wolf', g: { z: 'warband' as const, gi: 2, ow: 1 as const } };
  const aim = { x: 0.4, y: 0.6, gx: 0.41, gy: 0.62, an: { k: 's:heroPower', fx: 0.5, fy: 0.5 }, on: true, def: 'arrow', t: 'u3' };
  return [
    { x: 0.5, y: 0.5, gx: 0.512, gy: 0.433, an: { k: 'u:12', fx: 0.25, fy: 0.75 }, drag: null, aim: null, ts: 1000 },
    { x: 0.5, y: 0.5, gx: 0.515, gy: 0.44, an: { k: 'u:12', fx: 0.3, fy: 0.8 }, drag: null, aim: null, ts: 1050,
      tr: [[33, 0.513, 0.435, 'u:12', 0.26, 0.76], [16, 0.514, 0.438]] },
    { x: 0.5, y: 0.5, gx: 0.6, gy: 0.5, drag: held, aim: null, ts: 1100, tr: [[32, 0.55, 0.47], [17, 0.58, 0.49]] },
    { x: 0.5, y: 0.5, gx: 0.62, gy: 0.51, drag: { ...held, g: { z: 'warband', gi: 3, ow: 1 } }, aim: null, ts: 1150 },
    { x: 0.5, y: 0.5, gx: -0.02, gy: 1.04, drag: null, aim: null, ts: 1200, de: 'x' },
    { x: 0.5, y: 0.5, gx: 0.3, gy: 0.3, drag: null, aim, ts: 1260 },
    { x: 0.5, y: 0.5, gx: 0.31, gy: 0.3, drag: null, aim: { ...aim, on: false }, ts: 1310 },
    { x: 0, y: 0, hide: true, ts: 5400, an: { k: 'u:12', fx: 0.3, fy: 0.8 } },
    { x: 0.5, y: 0.5, gx: 0.31, gy: 0.3, drag: null, aim: null, ts: 9000, de: 'c' },
  ];
}

describe('R-REPLAY-STREAM-01: the stream codec', () => {
  it('round-trips every message shape exactly (minus x / y)', () => {
    const enc = newStreamEncoder(4, 1000);
    const msgs = messages();
    for (const b of msgs) expect(encodeStreamMessage(enc, b, b.ts!)).toBe(true);
    const out = decodeStreamSegment(JSON.parse(JSON.stringify(sealStreamSegment(enc))));
    expect(out).toEqual(msgs.map(strip));
    expect(enc.seg.n).toBe(msgs.length);
    expect(enc.seg.t1).toBe(9000);
    expect(enc.seg.w).toBe(4);
  });

  it('stores the held card and the aim only when they change', () => {
    const enc = newStreamEncoder(1, 0);
    const held = { uid: 'a', source: 'hand', cardId: 'c' };
    for (let i = 0; i < 20; i++) encodeStreamMessage(enc, { x: 0, y: 0, gx: r3(i / 100), gy: 0.5, drag: held, aim: null, ts: i * 50 }, i * 50);
    encodeStreamMessage(enc, { x: 0, y: 0, gx: 0.3, gy: 0.5, drag: null, aim: null, ts: 1000 }, 1000);
    expect(enc.seg.s).toEqual([{ d: held }, { d: null }]);
    const out = decodeStreamSegment(sealStreamSegment(enc));
    expect(out.slice(0, 20).every((b) => b.drag?.uid === 'a')).toBe(true);
    expect(out[20]!.drag).toBeNull();
  });

  it('the segment cap drops only position-only messages; a change still lands', () => {
    const enc = newStreamEncoder(1, 0);
    for (let i = 0; i < STREAM_SEG_MAX_MSGS; i++) encodeStreamMessage(enc, { x: 0, y: 0, gx: 0.5, gy: 0.5, drag: null, aim: null, ts: i }, i);
    expect(encodeStreamMessage(enc, { x: 0, y: 0, gx: 0.6, gy: 0.5, drag: null, aim: null, ts: 99999 }, 99999)).toBe(false);
    expect(encodeStreamMessage(enc, { x: 0, y: 0, gx: 0.6, gy: 0.5, drag: { uid: 'u', source: 'shop', cardId: 'c' }, aim: null, ts: 100000 }, 100000)).toBe(true);
    expect(encodeStreamMessage(enc, { x: 0, y: 0, hide: true, ts: 100001 }, 100001)).toBe(true);
    const out = decodeStreamSegment(sealStreamSegment(enc));
    expect(out.at(-2)!.drag?.uid).toBe('u');
    expect(out.at(-1)!.hide).toBe(true);
    // the run cap (full) does the same from the first message
    const enc2 = newStreamEncoder(1, 0);
    expect(encodeStreamMessage(enc2, { x: 0, y: 0, gx: 0.6, gy: 0.5, drag: null, aim: null, ts: 1 }, 1, true)).toBe(false);
  });

  it('a message never goes back in time on the frames clock', () => {
    const enc = newStreamEncoder(1, 500);
    encodeStreamMessage(enc, { x: 0, y: 0, gx: 0.1, gy: 0.1, drag: null, aim: null, ts: 700 }, 700);
    encodeStreamMessage(enc, { x: 0, y: 0, gx: 0.2, gy: 0.1, drag: null, aim: null, ts: 650 }, 650);
    expect(decodeStreamSegment(sealStreamSegment(enc)).map((b) => b.ts)).toEqual([700, 700]);
  });

  it('events round-trip; a shift moves only the clock; validation accepts a stream and rejects junk', () => {
    const enc = newStreamEncoder(3, 2000);
    encodeStreamEvent(enc, 2500, EV_OVERLAY, overlayBitsOf({ discover: true, power: false, quest: false, forge: true }));
    encodeStreamEvent(enc, 7000, EV_SKIP);
    expect(decodeStreamEvents(enc.seg)).toEqual([{ t: 2500, code: EV_OVERLAY, value: 9 }, { t: 7000, code: EV_SKIP, value: 0 }]);
    expect(enc.seg.t1).toBe(7000);
    const sealed = sealStreamSegment(enc);
    const moved = shiftStreamSegment(sealed, 1200);
    expect(decodeStreamEvents(moved).map((e) => e.t)).toEqual([3700, 8200]);
    expect(moved.m).toBe(sealed.m);
    expect(isReplayStream({ v: 1, segs: [sealed] })).toBe(true);
    expect(isReplayStream({ v: 1, segs: [{ ...sealed, m: [1, 2] }] })).toBe(false);
    expect(isReplayStream({ v: 2, segs: [] })).toBe(false);
    expect(isReplayStream({ v: 1, segs: [{ w: 1 }] })).toBe(false);
  });

  it('packs integers exactly: small, negative, large, and every remainder of the base64 grouping', () => {
    const cases = [[], [0], [1, -1], [63, -64, 64, -65], [1000, -1000, 123456789, -987654321, 2 ** 40, -(2 ** 40)], Array.from({ length: 301 }, (_, i) => (i * 37) % 200 - 100)];
    for (const ints of cases) {
      const s = packInts(ints);
      expect(/^[A-Za-z0-9+/]*$/.test(s)).toBe(true);
      expect(unpackInts(s)).toEqual(ints);
    }
    // nearly every stream integer is under 64 in magnitude: one byte each
    expect(packInts(Array.from({ length: 300 }, () => 5)).length).toBe(400);
  });

  it('a sealed segment is a snapshot: the encoder keeps going without changing it', () => {
    const enc = newStreamEncoder(1, 0);
    encodeStreamMessage(enc, { x: 0, y: 0, gx: 0.1, gy: 0.1, drag: null, aim: null, ts: 10 }, 10);
    const a = sealStreamSegment(enc);
    encodeStreamMessage(enc, { x: 0, y: 0, gx: 0.2, gy: 0.1, drag: null, aim: null, ts: 20 }, 20);
    expect(decodeStreamSegment(a)).toHaveLength(1);
    expect(decodeStreamSegment(sealStreamSegment(enc))).toHaveLength(2);
  });
});
