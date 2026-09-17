import { describe, expect, it, vi } from 'vitest';
import {
  buildDiceTimeline, cubicBezier, diceCosmetics, diceSeed, FACE_PIPS, FACE_ROT, faceUp, shadowFor, type DieFace,
} from './diceRollTimeline';

/**
 * The DICE ROLL timeline (owner handoff 2026-09-17), proven without a DOM:
 *   • every result lands on the correct face — 100 forced rolls per face, each from a different previous rest
 *     pose and seed, driven to t = 1 and resolved GEOMETRICALLY (`faceUp` rotates the face normals through the
 *     cube's final matrix; it does not read the table the timeline was built from);
 *   • the same event replays identically (seeded rest angle + jitter pinned);
 *   • `onLand` fires once at first contact and `onComplete` once at the settle;
 *   • the reduced-motion path shows the face with no hop and no spins.
 */
const FACES: DieFace[] = [1, 2, 3, 4, 5, 6];

describe('faceUp — the geometric resolve', () => {
  it('reads each face back from its own rest rotation, and from any number of extra full turns', () => {
    for (const f of FACES) {
      const { x, y } = FACE_ROT[f];
      expect(faceUp(x, y)).toBe(f);
      expect(faceUp(x + 720, y - 1080)).toBe(f);
      expect(faceUp(x - 360, y + 360 * 5)).toBe(f);
    }
  });
  it('opposite faces sum to 7 (a real die), by the pip layout and by the geometry', () => {
    for (const f of FACES) {
      expect(FACE_PIPS[f].length).toBe(f);
      const { x, y } = FACE_ROT[f];
      // Half a turn on Y flips a face on the X/Z ring to its opposite; on Y-axis faces, half a turn on X does.
      const opposite = f === 2 || f === 5 ? faceUp(x + 180, y) : faceUp(x, y + 180);
      expect(opposite + f).toBe(7);
    }
  });
});

describe('cubicBezier', () => {
  it('pins the endpoints and stays monotonic for the three handoff curves', () => {
    for (const [a, b, c, d] of [[0.15, 0.55, 0.25, 1], [0.2, 0.8, 0.4, 1], [0.6, 0, 0.9, 0.4]] as const) {
      const e = cubicBezier(a, b, c, d);
      expect(e(0)).toBe(0);
      expect(e(1)).toBe(1);
      let prev = 0;
      for (let i = 1; i <= 50; i++) { const v = e(i / 50); expect(v).toBeGreaterThanOrEqual(prev - 1e-9); prev = v; }
    }
  });
});

describe('buildDiceTimeline — all six results land on the correct face', () => {
  for (const result of FACES) {
    it(`result ${result}: 100 forced rolls, no mismatch`, () => {
      let from = { rx: 0, ry: 0 };
      for (let i = 0; i < 100; i++) {
        const seed = diceSeed(i % 2 ? 'power' : 'spell', i, result);
        const { restAngle } = diceCosmetics(seed);
        const built = buildDiceTimeline({
          result, from,
          tumbleTime: 400 + (i * 37) % 1800, hopHeight: (i * 7) % 150, spinCount: 1 + (i % 6), settleBounce: (i % 6) * 0.1,
          restAngle,
        });
        built.tl.progress(1);
        expect(faceUp(built.state.rx, built.state.ry)).toBe(result);
        expect(built.state.z).toBe(0);
        expect(built.state.scale).toBe(1);
        // The bare rest pose is the face's own rotation mod 360, handed to the next roll as `from`.
        expect(built.rest).toEqual({ rx: ((FACE_ROT[result].x % 360) + 360) % 360, ry: ((FACE_ROT[result].y % 360) + 360) % 360 });
        expect(faceUp(built.rest.rx, built.rest.ry)).toBe(result);
        // Next roll starts from a DIFFERENT previous face each time round, so the from→end path varies.
        const prev = FACE_ROT[FACES[(i + result) % 6]!];
        from = { rx: prev.x, ry: prev.y };
      }
    });
  }

  it('makes at least `spinCount` full turns on X and one more on Y, then overshoots and rocks back', () => {
    const b = buildDiceTimeline({ result: 3, from: { rx: 90, ry: 0 }, tumbleTime: 1000, hopHeight: 80, spinCount: 3, settleBounce: 0.22, restAngle: 7 });
    b.tl.progress(1);
    // Face 3 rests at X0 / Y-90 (= 270). From X90 the target is BEHIND the start, so X takes an extra turn.
    const endX = 0 + 360 * 3 + 360, endY = 270 + 360 * 4;
    expect(b.state.rx).toBe(endX);
    expect(b.state.ry).toBe(endY);
    expect(b.state.rx - 90).toBeGreaterThanOrEqual(360 * 3);
    // Past the end at the end of the tumble segment (overshoot), back past it during the rock, exact at 1.
    b.tl.progress(0.74);
    expect(b.state.rx).toBeCloseTo(endX + 0.22 * 60, 3);
    expect(b.state.ry).toBeCloseTo(endY + 0.22 * 60 * 0.6, 3);
    b.tl.progress(0.88);
    expect(b.state.rx).toBeCloseTo(endX - 0.35 * 0.22 * 60, 3);
    b.tl.progress(1);
    expect(b.state.rx).toBe(endX);
  });

  it('hops: up by 0.30, down at 0.62 (contact), a smaller second hop, flat and unscaled at 1', () => {
    const b = buildDiceTimeline({ result: 1, from: { rx: 0, ry: 0 }, tumbleTime: 1000, hopHeight: 80, spinCount: 2, settleBounce: 0.25, restAngle: 0 });
    b.tl.progress(0.30); expect(b.state.z).toBeCloseTo(80, 3);
    b.tl.progress(0.62); expect(b.state.z).toBeCloseTo(0, 3);
    b.tl.progress(0.80); expect(b.state.z).toBeCloseTo(80 * 0.25, 3);
    b.tl.progress(1); expect(b.state.z).toBe(0); expect(b.state.scale).toBe(1);
    // The shadow is a function of height: lower, tighter and darker at rest than at the top of the hop.
    expect(shadowFor(0).opacity).toBeGreaterThan(shadowFor(80).opacity);
    expect(shadowFor(80).scale).toBeGreaterThan(shadowFor(0).scale);
  });

  it('yaws one full turn plus the seeded rest angle, done by 0.80', () => {
    const b = buildDiceTimeline({ result: 5, from: { rx: 0, ry: 0 }, tumbleTime: 700, hopHeight: 80, spinCount: 2, settleBounce: 0.22, restAngle: -11.5 });
    b.tl.progress(0.80); expect(b.state.yaw).toBeCloseTo(360 - 11.5, 3);
    b.tl.progress(1); expect(b.state.yaw).toBeCloseTo(360 - 11.5, 3);
  });

  it('fires onLand once at first contact and onComplete once at the settle', () => {
    const onLand = vi.fn(); const onComplete = vi.fn();
    const b = buildDiceTimeline({ result: 6, from: { rx: 0, ry: 0 }, tumbleTime: 1100, hopHeight: 80, spinCount: 3, settleBounce: 0.22, restAngle: 3, onLand, onComplete });
    b.tl.progress(0.5);
    expect(onLand).not.toHaveBeenCalled();
    b.tl.progress(0.7);
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    b.tl.progress(1);
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('reduced motion: 250 ms, no hop, no spins — the face is simply there', () => {
    const onLand = vi.fn();
    for (const result of FACES) {
      const b = buildDiceTimeline({ result, from: { rx: 90, ry: 180 }, tumbleTime: 1100, hopHeight: 80, spinCount: 3, settleBounce: 0.22, restAngle: 9, reducedMotion: true, onLand });
      expect(b.durationMs).toBe(250);
      b.tl.progress(0.5);
      expect(b.state.z).toBe(0);
      expect(b.state.yaw).toBe(0);
      b.tl.progress(1);
      expect(faceUp(b.state.rx, b.state.ry)).toBe(result);
      expect(b.state.rx).toBe(b.rest.rx);
      expect(b.state.ry).toBe(b.rest.ry);
    }
    expect(onLand).toHaveBeenCalledTimes(6);
  });
});

describe('seeded cosmetics — the same event replays identically', () => {
  it('the same key gives the same rest angle and jitter; the two callers never share a seed', () => {
    for (let wave = 1; wave <= 20; wave++) {
      for (const roll of FACES) {
        const a = diceCosmetics(diceSeed('power', wave, roll));
        const b = diceCosmetics(diceSeed('power', wave, roll));
        expect(a).toEqual(b);
        expect(diceSeed('power', wave, roll)).not.toBe(diceSeed('spell', wave, roll));
        expect(Math.abs(a.restAngle)).toBeLessThanOrEqual(15);
        expect(Math.abs(a.jitter.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(a.jitter.y)).toBeLessThanOrEqual(2);
      }
    }
  });
  it('different events do vary (the rest angle is not a constant)', () => {
    const angles = new Set(Array.from({ length: 40 }, (_, i) => diceCosmetics(diceSeed('spell', i + 1)).restAngle));
    expect(angles.size).toBeGreaterThan(10);
  });
  it('a full timeline replays to the same pose from the same seed and pose', () => {
    const run = (): { rx: number; ry: number; yaw: number } => {
      const { restAngle } = diceCosmetics(diceSeed('spell', 7));
      const b = buildDiceTimeline({ result: 4, from: { rx: 270, ry: 0 }, tumbleTime: 700, hopHeight: 80, spinCount: 2, settleBounce: 0.22, restAngle });
      b.tl.progress(0.41);
      const mid = { rx: b.state.rx, ry: b.state.ry, yaw: b.state.yaw };
      b.tl.progress(1);
      return { ...mid, yaw: mid.yaw + b.state.yaw };
    };
    expect(run()).toEqual(run());
  });
});

describe('the THROW (Gamble spell, owner follow-up 2026-09-17)', () => {
  const THROW = { dx: 180, dy: -120, bounceCount: 3, bounceDecay: 0.5 };

  for (const result of FACES) {
    it(`thrown result ${result}: 100 forced throws, no mismatch, lands at the spot`, () => {
      let from = { rx: 0, ry: 0 };
      for (let i = 0; i < 100; i++) {
        const seed = diceSeed('spell', i, result);
        const { restAngle } = diceCosmetics(seed);
        const built = buildDiceTimeline({
          result, from, restAngle,
          tumbleTime: 600 + (i * 41) % 1600, hopHeight: (i * 7) % 150, spinCount: 1 + (i % 6), settleBounce: (i % 6) * 0.1,
          throw: { dx: -250 + (i * 13) % 500, dy: -(i * 5) % 300, bounceCount: 1 + (i % 4), bounceDecay: 0.3 + (i % 5) * 0.1 },
        });
        built.tl.progress(1);
        expect(faceUp(built.state.rx, built.state.ry)).toBe(result);
        expect(built.state.z).toBeCloseTo(0, 6);
        expect(built.state.scale).toBe(1);
        expect(built.state.tx).toBeCloseTo(-250 + (i * 13) % 500, 9);
        expect(built.state.ty).toBeCloseTo(-(i * 5) % 300, 9);
        expect(faceUp(built.rest.rx, built.rest.ry)).toBe(result);
        const prev = FACE_ROT[FACES[(i + result) % 6]!];
        from = { rx: prev.x, ry: prev.y };
      }
    });
  }

  it('rolls WITH the distance: rotation progress equals travel progress at every sample', () => {
    const b = buildDiceTimeline({ result: 2, from: { rx: 0, ry: 0 }, tumbleTime: 1000, hopHeight: 80, spinCount: 2, settleBounce: 0.22, restAngle: 0, throw: THROW });
    b.tl.progress(1);
    const endX = b.state.rx, endY = b.state.ry;
    for (const p of [0.1, 0.25, 0.4, 0.6, 0.85, 0.95]) {
      b.tl.progress(p);
      const travel = b.state.tx / THROW.dx;
      expect(b.state.ty / THROW.dy).toBeCloseTo(travel, 6);
      expect(b.state.rx / endX).toBeCloseTo(travel, 6);
      expect(b.state.ry / endY).toBeCloseTo(travel, 6);
    }
    b.tl.progress(0.85);
    expect(b.state.tx).toBeCloseTo(THROW.dx, 6); // travel is done at the final touchdown
  });

  it('bounces `bounceCount` decaying parabolas: each apex halves, each touchdown is at z = 0, then the landing', () => {
    const onBounce = vi.fn(); const onLand = vi.fn(); const onComplete = vi.fn();
    const opts = { result: 4 as DieFace, from: { rx: 0, ry: 0 }, tumbleTime: 1000, hopHeight: 80, spinCount: 2, settleBounce: 0.22, restAngle: 0, throw: THROW };
    // Hang times ∝ √decay: h, h√.5, h·.5 summing to 0.85.
    const r = Math.sqrt(0.5); const h = 0.85 / (1 + r + r * r);
    const touchdowns = [h, h + h * r, 0.85];
    const apexes = [h / 2, h + (h * r) / 2, h + h * r + (h * r * r) / 2];
    // Geometry on a scrubbed copy (scrubbing back and forth re-fires GSAP callbacks, so the counts use a
    // separate timeline driven forward once, as the component does).
    const geo = buildDiceTimeline(opts);
    apexes.forEach((t, i) => { geo.tl.progress(t); expect(geo.state.z).toBeCloseTo(80 * 0.5 ** i, 3); });
    touchdowns.forEach((t) => { geo.tl.progress(t); expect(geo.state.z).toBeCloseTo(0, 3); });
    const b = buildDiceTimeline({ ...opts, onBounce, onLand, onComplete });
    b.tl.progress(0.84);
    expect(onBounce).toHaveBeenCalledTimes(2);
    expect(onBounce.mock.calls[0]![0]).toBe(0);
    expect(onBounce.mock.calls[1]![0]).toBe(1);
    // Each intermediate contact reports where on the ground it happened (short of the landing spot).
    const at0 = onBounce.mock.calls[0]![1] as { x: number; y: number };
    expect(Math.abs(at0.x)).toBeGreaterThan(0);
    expect(Math.abs(at0.x)).toBeLessThan(Math.abs(THROW.dx));
    expect(onLand).not.toHaveBeenCalled();
    b.tl.progress(1);
    expect(onBounce).toHaveBeenCalledTimes(2);
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('reduced motion: no throw — the die appears at the landing spot, face up, in 250 ms', () => {
    const onBounce = vi.fn();
    const b = buildDiceTimeline({ result: 6, from: { rx: 90, ry: 0 }, tumbleTime: 1000, hopHeight: 80, spinCount: 2, settleBounce: 0.22, restAngle: 0, throw: THROW, reducedMotion: true, onBounce });
    expect(b.durationMs).toBe(250);
    b.tl.progress(0.1);
    expect(b.state.tx).toBe(THROW.dx); expect(b.state.ty).toBe(THROW.dy); expect(b.state.z).toBe(0);
    b.tl.progress(1);
    expect(faceUp(b.state.rx, b.state.ry)).toBe(6);
    expect(onBounce).not.toHaveBeenCalled();
  });

  it('the power path is untouched by the throw knobs: no ground travel, no bounce callbacks', () => {
    const onBounce = vi.fn();
    const b = buildDiceTimeline({ result: 3, from: { rx: 0, ry: 0 }, tumbleTime: 1100, hopHeight: 80, spinCount: 3, settleBounce: 0.22, restAngle: 5, onBounce });
    b.tl.progress(1);
    expect(b.state.tx).toBe(0); expect(b.state.ty).toBe(0);
    expect(onBounce).not.toHaveBeenCalled();
  });
});
