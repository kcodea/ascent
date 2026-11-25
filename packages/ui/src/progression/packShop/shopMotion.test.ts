import { describe, expect, it } from 'vitest';
import {
  arrivingPlaceHidden, bindFan, handFanInto, hiddenAsleep, inRotatedRect, newPointerVel, newShake, newSwing,
  parksOnArrival, pointerVelDecay, resetPointerVel, rubberY, samplePointerVel, settleDip, softDead, staggerArrivals,
  stepShake, stepSwing,
} from './shopMotion';

describe('stepShake', () => {
  it('fires on three direction changes within 400 ms', () => {
    const s = newShake();
    expect(stepShake(s, 10, 0, 0)).toBe(false);
    expect(stepShake(s, -10, 0, 80)).toBe(false); // change 1
    expect(stepShake(s, 10, 0, 160)).toBe(false); // change 2
    expect(stepShake(s, -10, 0, 240)).toBe(true); // change 3
  });

  it('does not fire when the three changes take longer than 400 ms', () => {
    const s = newShake();
    stepShake(s, 10, 0, 0);
    stepShake(s, -10, 0, 100);
    stepShake(s, 10, 0, 300);
    expect(stepShake(s, -10, 0, 520)).toBe(false); // 100 -> 520 is 420 ms
    expect(stepShake(s, 10, 0, 600)).toBe(true); // 300, 520, 600: within the window
  });

  it('ignores tiny moves and a steady drag', () => {
    const s = newShake();
    for (let t = 0; t < 400; t += 16) expect(stepShake(s, 12, 3, t)).toBe(false);
    stepShake(s, 12, 0, 500);
    expect(stepShake(s, -1, 0, 510)).toBe(false);
    expect(stepShake(s, 1, 0, 520)).toBe(false);
    expect(stepShake(s, -1, 0, 530)).toBe(false);
  });

  it('counts vertical shakes too, and starts over after firing', () => {
    const s = newShake();
    stepShake(s, 0, 10, 0);
    stepShake(s, 0, -10, 50);
    stepShake(s, 0, 10, 100);
    expect(stepShake(s, 0, -10, 150)).toBe(true);
    expect(stepShake(s, 0, 10, 200)).toBe(false); // the history was cleared
  });
});

describe('rubberY', () => {
  it('leaves a point above the line alone', () => {
    expect(rubberY(100, 300, 40)).toBe(100);
    expect(rubberY(300, 300, 40)).toBe(300);
  });

  it('pulls a point below the line back, never further than `reach` past it, and keeps the order', () => {
    const a = rubberY(320, 300, 40), b = rubberY(400, 300, 40), c = rubberY(2000, 300, 40);
    expect(a).toBeGreaterThan(300);
    expect(a).toBeLessThan(320);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThanOrEqual(340);
  });
});

describe('stepSwing', () => {
  it('a tag swings back against the pack\'s acceleration, then settles to rest', () => {
    const s = newSwing();
    stepSwing(s, 0.5, 1);
    expect(s.a).toBeGreaterThan(0); // pack accelerates right: the tag's bottom lags left (clockwise)
    let moving = true;
    for (let i = 0; i < 2000 && moving; i++) moving = stepSwing(s, 0, 1);
    expect(moving).toBe(false);
    expect(s.a).toBe(0);
    expect(s.v).toBe(0);
  });

  it('stays bounded under a long hard shove', () => {
    const s = newSwing();
    for (let i = 0; i < 100; i++) stepSwing(s, 50, 3);
    expect(Math.abs(s.a)).toBeLessThanOrEqual(0.9);
  });
});

describe('handFanInto', () => {
  const out = { places: 0, shown: 0, piled: 0 };

  it('a small hand fans every pack; a reserved place adds one', () => {
    expect(handFanInto(out, 3, 0)).toEqual({ places: 3, shown: 3, piled: 0 });
    expect(handFanInto(out, 3, 1)).toEqual({ places: 4, shown: 4, piled: 0 });
    expect(handFanInto(out, 0, 0)).toEqual({ places: 0, shown: 0, piled: 0 });
  });

  it('a large hand counts the pile as a place', () => {
    expect(handFanInto(out, 7, 0)).toEqual({ places: 7, shown: 7, piled: 0 });
    expect(handFanInto(out, 7, 1)).toEqual({ places: 7, shown: 6, piled: 2 });
    expect(handFanInto(out, 18, 0)).toEqual({ places: 7, shown: 6, piled: 12 });
  });
});

describe('hiddenAsleep', () => {
  it('sleeps only when faded all the way out, meant to stay out, and no Aether is in flight', () => {
    expect(hiddenAsleep(0, 0, 0)).toBe(true);
    expect(hiddenAsleep(0.4, 0, 0)).toBe(false); // still fading out
    expect(hiddenAsleep(0, 1, 0)).toBe(false); // setVisible(true): fading back in
    expect(hiddenAsleep(0, 0, 3)).toBe(false); // a stream still flying
    expect(hiddenAsleep(1, 1, 0)).toBe(false);
  });
});

describe('inRotatedRect', () => {
  // a 20 x 100 pack centred at the origin
  it('without rotation it is the plain box', () => {
    expect(inRotatedRect(9, 49, 0, 0, 20, 100, 0)).toBe(true);
    expect(inRotatedRect(11, 0, 0, 0, 20, 100, 0)).toBe(false);
  });

  it('a point inside the rotated pack but outside its axis-aligned box hits', () => {
    // rotated a quarter turn clockwise, the pack lies along x: (40, 0) is outside the unrotated 20-wide box
    expect(inRotatedRect(40, 0, 0, 0, 20, 100, Math.PI / 2)).toBe(true);
    // at 0.3 rad the top end swings right: a point near its top-right corner
    const r = 0.3, tx = 50 * Math.sin(r), ty = -50 * Math.cos(r);
    expect(Math.abs(tx)).toBeGreaterThan(10);
    expect(inRotatedRect(tx, ty, 0, 0, 20, 100, r)).toBe(true);
  });

  it('a point inside the axis-aligned box but outside the rotated pack misses', () => {
    expect(inRotatedRect(0, 45, 0, 0, 20, 100, Math.PI / 2)).toBe(false);
    expect(inRotatedRect(-9, -48, 0, 0, 20, 100, 0.3)).toBe(false);
    expect(inRotatedRect(-9, -48, 0, 0, 20, 100, 0)).toBe(true);
  });

  it('honours the centre', () => {
    expect(inRotatedRect(105, 200, 100, 200, 20, 100, 0.3)).toBe(true);
    expect(inRotatedRect(5, 0, 100, 200, 20, 100, 0.3)).toBe(false);
  });
});

describe('parksOnArrival', () => {
  it('a played pack parks on the pedestal unless the scene was shown again during its travel', () => {
    expect(parksOnArrival('toPedestal', false)).toBe(true);
    expect(parksOnArrival('toPedestal', true)).toBe(false);
    expect(parksOnArrival('toHand', false)).toBe(false);
    expect(parksOnArrival('toShelf', false)).toBe(false);
  });
});

describe('arrivingPlaceHidden', () => {
  it('hides the fan\'s last place while a purchase waits or travels in, once the hand has grown', () => {
    expect(arrivingPlaceHidden('buying', 4, 3, 3, 4)).toBe(true);
    expect(arrivingPlaceHidden('toHand', 4, 3, 3, 4)).toBe(true);
  });

  it('hides nothing before the hand grows, for other places, or in other phases', () => {
    expect(arrivingPlaceHidden('buying', 3, 3, 3, 4)).toBe(false);
    expect(arrivingPlaceHidden('buying', 4, 3, 2, 4)).toBe(false);
    expect(arrivingPlaceHidden('toShelf', 4, 3, 3, 4)).toBe(false);
    expect(arrivingPlaceHidden('idle', 4, 3, 3, 4)).toBe(false);
  });
});

describe('softDead', () => {
  it('is zero inside the dead zone and continuous at its edge (no step when a crawl becomes a move)', () => {
    expect(softDead(0.3, 0.6)).toBe(0);
    expect(softDead(-0.6, 0.6)).toBe(0);
    expect(softDead(0.61, 0.6)).toBeCloseTo(0.01);
    expect(softDead(-2, 0.6)).toBeCloseTo(-1.4);
  });
});

describe('the pointer velocity estimate', () => {
  it('reads a steady drag at its true speed (px per 60 Hz frame), whatever the event rate', () => {
    for (const every of [1, 4, 8, 16]) { // a 1000 Hz, 250 Hz, 125 Hz and 60 Hz pointer
      const p = newPointerVel();
      resetPointerVel(p, 0, 0, 0);
      for (let t = every; t <= 600; t += every) samplePointerVel(p, t * 0.3, 0, t); // 0.3 px/ms = 5 px/frame
      expect(p.vx).toBeCloseTo(5, 1);
      expect(p.vy).toBe(0);
    }
  });

  it('ignores a repeated timestamp, and decays to zero once the pointer stops sending moves', () => {
    const p = newPointerVel();
    resetPointerVel(p, 0, 0, 0);
    for (let t = 8; t <= 400; t += 8) samplePointerVel(p, t * 0.3, 0, t);
    samplePointerVel(p, 9999, 0, 400); // same timestamp: no infinite speed
    expect(p.vx).toBeCloseTo(5, 1);
    expect(pointerVelDecay(p, 410)).toBe(1); // a frame between events: still moving
    expect(pointerVelDecay(p, 500)).toBeLessThan(0.3);
    expect(pointerVelDecay(p, 900)).toBeLessThan(0.001);
  });

  it('a reset starts from rest (a pick-up never inherits the last drag)', () => {
    const p = newPointerVel();
    resetPointerVel(p, 0, 0, 0);
    samplePointerVel(p, 100, 100, 16);
    resetPointerVel(p, 5, 5, 20);
    expect(p.vx).toBe(0); expect(p.vy).toBe(0);
  });
});

describe('settleDip', () => {
  it('a small bob: zero at the start and the end with no kink, deepest in the middle', () => {
    expect(settleDip(0)).toBe(0);
    expect(settleDip(1)).toBe(0);
    expect(settleDip(-0.2)).toBe(0);
    expect(settleDip(1.5)).toBe(0);
    expect(settleDip(0.5)).toBeCloseTo(1);
    expect(settleDip(0.02)).toBeLessThan(0.01); // eases in: no velocity step on arrival
    expect(settleDip(0.98)).toBeLessThan(0.01);
  });
});

describe('bindFan', () => {
  const H = (...ids: string[]) => ids.map((packId) => ({ packId }));
  const make = () => ({ viewId: new Array<string | null>(7).fill(null), placeView: new Int32Array(7).fill(-1), fresh: new Uint8Array(7) });

  it('binds each shown pack to a view, marking new ones fresh', () => {
    const b = make();
    expect(bindFan(b.viewId, b.placeView, b.fresh, H('a', 'b', 'c'), 3)).toBe(true);
    expect([...b.placeView].slice(0, 3).map((v) => b.viewId[v])).toEqual(['a', 'b', 'c']);
    expect([...b.fresh].filter(Boolean)).toHaveLength(3);
  });

  it('a pack keeps its own view when its place changes, and a pack new to the fan takes a free one', () => {
    const b = make();
    bindFan(b.viewId, b.placeView, b.fresh, H('a', 'b', 'c'), 3);
    const vb = b.placeView[1]!, vc = b.placeView[2]!;
    b.fresh.fill(0);
    bindFan(b.viewId, b.placeView, b.fresh, H('b', 'c', 'd'), 3); // 'a' played: b and c shift down a place
    expect(b.placeView[0]).toBe(vb);
    expect(b.placeView[1]).toBe(vc);
    expect(b.viewId[b.placeView[2]!]).toBe('d');
    expect(b.fresh[vb]).toBe(0); expect(b.fresh[vc]).toBe(0); expect(b.fresh[b.placeView[2]!]).toBe(1);
    expect(b.viewId.filter((id) => id === 'a')).toHaveLength(0); // the played pack's view is free
    expect(b.placeView[3]).toBe(-1);
  });

  it('reports no change when nothing moved, and binds only `count` places', () => {
    const b = make();
    bindFan(b.viewId, b.placeView, b.fresh, H('a', 'b', 'c', 'd'), 2);
    expect(b.viewId.filter(Boolean)).toEqual(expect.arrayContaining(['a', 'b']));
    expect(b.viewId.filter(Boolean)).toHaveLength(2);
    expect(bindFan(b.viewId, b.placeView, b.fresh, H('a', 'b', 'c', 'd'), 2)).toBe(false);
  });
});

describe('staggerArrivals', () => {
  it('packs new to a hand that grew by more than one arrive one after another', () => {
    const out = new Map<string, number>();
    const n = staggerArrivals(new Set(['a']), [{ packId: 'a' }, { packId: 'b' }, { packId: 'c' }, { packId: 'd' }], 100, 4, out);
    expect(n).toBe(3);
    expect(out.get('b')).toBe(100); expect(out.get('c')).toBe(104); expect(out.get('d')).toBe(108);
    expect(out.has('a')).toBe(false);
  });

  it('a single new pack, or a first hand, arrives at once (nothing staggered)', () => {
    const out = new Map<string, number>();
    expect(staggerArrivals(new Set(['a']), [{ packId: 'a' }, { packId: 'b' }], 0, 4, out)).toBe(0);
    expect(out.size).toBe(0);
  });
});
