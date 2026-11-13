// @vitest-environment jsdom
/**
 * THE PINBALL HERO ATTACK ("Multiball", a Legendary, dev-only until it has a cosmetic): the shared tiers onto the four
 * looks; the tuner values; the pure plan (the blow lands ONCE, when the first ball hits the target; the flip, the
 * bumpers, the ramp, the tilt and the roll-up never touch it); the bounce order rolled from the seed; the geometry
 * (flipper, bumpers, lane, ramp and display all on screen, in both directions and with the target tucked in a corner);
 * the balls' paths (every ball ends on the target's centre); the lights; the jackpot's reels stopping on the damage;
 * the tilt; the runner (both portraits' transforms, the opacity and the z-order restored exactly on the end, finish,
 * cancel and the safety timer; every own object hidden; the scene's root level again); the scene; the sounds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES } from '../heroBlast/heroAttackStyle';
import { ATTACK_FX_CLIPS } from '../audio/codeClips';
import {
  BUMPERS, DISPLAY_ASPECT, HERO_PINBALL_CLIP_KEYS, HERO_PINBALL_DEFAULTS, HERO_PINBALL_RANGES, PINBALL_CAPS, arrowLit, ballAt, bumperAt, clampHeroPinballValue,
  displayAt, flipperAngle, heroPinballConfigJson, jackpotCells, jackpotDigits, jackpotValue, PAYOUTS, lampAt, newBallState, newBumperState, pinballCameraAt, pinballCues, pinballGeo,
  pinballKind, pinballPaths, pinballPlan, rampAt, strikerPose, tableIn, tiltAt, type HeroPinballNumKey,
} from './heroPinballConfig';
import { HeroPinballScene, MAX_PINBALL_SPRITES, type HeroPinballTextures } from './heroPinballScene';
import { playHeroPinball, pinballSeed, type HeroPinballOptions } from './heroPinball';
import { SPEC } from '../HeroPinballTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroPinballTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  ball: W, shadow: W, trail: W, flipper: W, bumper: W, bumperLit: W, lamps: W, lampsLit: W, arrow: W, arrowLit: W, rail: W, panel: W,
  wordMultiball: W, wordTilt: W, wordJackpot: W, digit0: W, digit1: W, digit2: W, digit3: W, digit4: W, digit5: W, digit6: W, digit7: W, digit8: W, digit9: W,
  plus10: W, plus50: W,
};
const C = HERO_PINBALL_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean; seed?: number } = {}) => pinballPlan({ total, leadIn: leadInOf([total], o.reduced), ...o }, C);
const R = 110;
const FRAME = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
/** Layouts: you striking up the screen, the foe striking down it, the real shop (target tucked in the top right corner), and its mirror. */
const LAYOUTS: [string, { x: number; y: number }, { x: number; y: number }][] = [
  ['up the screen', { x: 960, y: 900 }, { x: 960, y: 180 }],
  ['down the screen', { x: 960, y: 180 }, { x: 960, y: 900 }],
  ['to the top right corner', { x: 170, y: 850 }, { x: 1773, y: 161 }],
  ['back to the bottom left corner', { x: 1773, y: 161 }, { x: 170, y: 850 }],
  ['side by side', { x: 300, y: 540 }, { x: 1600, y: 560 }],
];
const inFrame = (p: { x: number; y: number }, m = 0): boolean => p.x >= m - 0.01 && p.x <= 1920 - m + 0.01 && p.y >= m - 0.01 && p.y <= 1080 - m + 0.01;
const dist = (p: { x: number; y: number }, q: { x: number; y: number }): number => Math.hypot(p.x - q.x, p.y - q.y);
const TOTALS = [3, 8, 14, 40];

describe('the tiers: the shared four onto the four looks', () => {
  it('uses the shared thresholds; I flipper, II bumpers, III multiball, IV jackpot; a knockout plays the jackpot', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).kind, `dmg ${d}`).toBe(pinballKind(tierOf(d)));
    expect([1, 2, 3, 4].map((t) => pinballKind(t as 1 | 2 | 3 | 4))).toEqual(['flipper', 'bumpers', 'multiball', 'jackpot']);
    expect(plan(2, { knockout: true })).toMatchObject({ tier: 4, kind: 'jackpot', total: 2 });
  });

  it('is a registered dev style, with no cosmetic of its own yet', () => {
    expect(HERO_ATTACK_STYLES).toContain('pinball');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('pinball');
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; buttons on top; a clip row per sound', () => {
    for (const [k, [min, max]] of Object.entries(HERO_PINBALL_RANGES)) {
      const v = C[k as HeroPinballNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroPinballValue('tiltDeg', 99)).toBe(12);
    expect(clampHeroPinballValue('colorLamp', 'nope')).toBe(C.colorLamp);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroPinballConfigJson(C)).previewDamage).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    expect((SPEC.actions ?? []).map((a) => a.label).filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
    for (const k of HERO_PINBALL_CLIP_KEYS) {
      expect(keys.has(k as never), k).toBe(true);
      expect(keys.has(k.replace('Clip', 'Gain') as never), k).toBe(true);
      expect(keys.has(k.replace('Clip', 'Rate') as never), k).toBe(true);
    }
  });

  it('every clip it names is in its registered clip list, and none of the source attack\'s are left', () => {
    const named = HERO_PINBALL_CLIP_KEYS.map((k) => C[k]).sort();
    expect([...ATTACK_FX_CLIPS.pinball!].sort()).toEqual(named);
    expect(named.join(' ')).not.toMatch(/soccer|bball/);
  });
});

describe('the plan', () => {
  it('I: the table pops up, the flipper fires, the ball flies straight to the target; no bumpers, one ball', () => {
    const p = plan(3);
    expect(p).toMatchObject({ kind: 'flipper', bumpers: 0, balls: 1, hits: [], echoes: [], chaseAt: null, rampInAt: null, multiAt: null, tiltAt: null, rollAt: null });
    expect(p.chargeAt).toBe(leadInOf([3]));
    expect(p.startAt).toBeGreaterThan(p.chargeAt);
    expect(p.strikeAt).toBeGreaterThan(p.startAt);
    expect(p.impactAt - p.strikeAt).toBe(C.t1FlightMs);
    expect(p.outAt).toBeGreaterThan(p.impactAt);
    expect(p.endAt).toBeGreaterThan(p.outAt);
  });

  it('II: five or six fast bounces, never the same bumper twice running, then the drop onto the target', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = plan(8, { seed });
      expect(p.kind).toBe('bumpers');
      expect(p.hits).toHaveLength(C.t2Bounces);
      expect(p.hits.length).toBeGreaterThanOrEqual(5);
      expect(p.hits[0]!.at).toBe(p.strikeAt + C.t2FlightMs);
      for (let i = 1; i < p.hits.length; i++) {
        expect(p.hits[i]!.bumper, `seed ${seed} hit ${i}`).not.toBe(p.hits[i - 1]!.bumper);
        const gap = p.hits[i]!.at - p.hits[i - 1]!.at;
        expect(gap).toBeGreaterThan(C.t2BounceMs * 0.8);
        expect(gap).toBeLessThan(C.t2BounceMs * 1.2);
      }
      for (const h of p.hits) { expect(h.bumper).toBeGreaterThanOrEqual(0); expect(h.bumper).toBeLessThan(BUMPERS); expect(h.ball).toBe(0); expect(h.at).toBeLessThan(p.impactAt); }
      expect(p.impactAt).toBe(p.hits[p.hits.length - 1]!.at + C.t2DropMs);
    }
  });

  it('III: the ramp, then THREE balls, each to its own bumper first; the blow lands with the first, the other two are echoes in order', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = plan(14, { seed });
      expect(p).toMatchObject({ kind: 'multiball', balls: 3, bumpers: BUMPERS });
      expect(p.rampInAt).toBe(p.strikeAt + C.t3FlightMs);
      expect(p.multiAt).toBe(p.rampInAt! + C.rampMs);
      const firsts = [0, 1, 2].map((b) => p.hits.find((h) => h.ball === b)!.bumper);
      expect(new Set(firsts).size, `seed ${seed}`).toBe(3);
      for (let b = 0; b < 3; b++) expect(p.hits.filter((h) => h.ball === b)).toHaveLength(C.t3Bounces);
      for (let i = 1; i < p.hits.length; i++) expect(p.hits[i]!.at).toBeGreaterThanOrEqual(p.hits[i - 1]!.at);
      expect(p.hits[0]!.at).toBeGreaterThan(p.multiAt!);
      expect(p.echoes).toHaveLength(2);
      expect(p.echoes[0]!).toBeGreaterThan(p.impactAt);
      expect(p.echoes[1]!).toBeGreaterThan(p.echoes[0]!);
      expect(p.echoes[1]! - p.impactAt).toBeLessThan(400);
      expect(p.outAt).toBe(p.echoes[1]! + C.t3HoldMs);
    }
  });

  it('IV: the chase, the wild ball, the tilt, then the roll-up running right up to the impact', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = plan(40, { seed });
      expect(p).toMatchObject({ kind: 'jackpot', balls: 1, bumpers: BUMPERS, echoes: [] });
      expect(p.strikeAt - p.chaseAt!).toBe(C.chaseMs);
      expect(p.hits.length).toBeGreaterThanOrEqual(9);
      expect(p.hits.length).toBeLessThanOrEqual(PINBALL_CAPS.hits);
      expect(p.tiltAt).toBe(p.hits[C.t4Bounces - 1]!.at);
      expect(p.tiltEnd! - p.tiltAt!).toBe(C.tiltMs);
      expect(p.rollAt!).toBeGreaterThanOrEqual(p.tiltEnd!);
      expect(p.impactAt - p.rollAt!).toBeGreaterThan(300);
      expect(p.impactAt - p.rollAt!).toBeLessThanOrEqual(C.rollMs + 1);
      // The ball is still bouncing through the roll-up: its last bumper is just before the impact.
      const last = p.hits[p.hits.length - 1]!.at;
      expect(p.impactAt - last).toBeGreaterThanOrEqual(C.t4DropMs - 0.001);
      expect(p.impactAt - last).toBeLessThan(320);
    }
  });

  it('the bounce order comes from the seed and nothing else: the same seed replays, other seeds differ', () => {
    for (const total of [8, 14, 40]) {
      expect(plan(total, { seed: 77 })).toEqual(plan(total, { seed: 77 }));
      const orders = new Set(Array.from({ length: 30 }, (_, i) => plan(total, { seed: i + 1 }).hits.map((h) => h.bumper).join('')));
      expect(orders.size, `total ${total}`).toBeGreaterThan(5);
    }
    expect(pinballSeed(12, 800, 'player')).toBe(pinballSeed(12, 800, 'player'));
    expect(pinballSeed(12, 800, 'player')).not.toBe(pinballSeed(12, 800, 'opp'));
  });

  it('each look runs longer than the last, in the range of the other Legendaries; nothing carries a hit-stop', () => {
    const len = TOTALS.map((t) => { const p = plan(t); return p.endAt - p.chargeAt; });
    expect(len[0]!).toBeGreaterThan(900); expect(len[0]!).toBeLessThan(1800);
    expect(len[1]!).toBeGreaterThan(len[0]!); expect(len[2]!).toBeGreaterThan(len[1]!); expect(len[3]!).toBeGreaterThan(len[2]!);
    // IV is long on purpose (the roll-up before the blow and the payout after it), never past 6 s.
    expect(len[3]!).toBeGreaterThan(4600); expect(len[3]!).toBeLessThan(6000);
    const p4 = plan(40);
    expect(p4.outAt - p4.impactAt).toBeGreaterThanOrEqual(1400); // the aftermath lingers
    expect(Object.keys(plan(40)).join(' ')).not.toMatch(/hitStop|freeze|slow/i);
  });

  it('the cues: in time order, ONE impact, one end, a bump per hit, an echo per following ball', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      const q = pinballCues(p);
      for (let i = 1; i < q.length; i++) expect(q[i]!.at).toBeGreaterThanOrEqual(q[i - 1]!.at);
      expect(q.filter((x) => x.kind === 'impact')).toHaveLength(1);
      expect(q.filter((x) => x.kind === 'end')).toHaveLength(1);
      expect(q[q.length - 1]!.kind).toBe('end');
      expect(q.filter((x) => x.kind === 'bump')).toHaveLength(p.hits.length);
      expect(q.filter((x) => x.kind === 'echo')).toHaveLength(p.echoes.length);
      expect(q.find((x) => x.kind === 'impact')!.at).toBe(p.impactAt);
      expect(q.filter((x) => x.kind === 'tilt' || x.kind === 'roll' || x.kind === 'chase')).toHaveLength(total === 40 ? 3 : 0);
      expect(q.filter((x) => x.kind === 'ramp' || x.kind === 'multi')).toHaveLength(total === 14 ? 2 : 0);
      // IV only: the score's climbing ticks (all inside the roll-up, closer together toward the impact) and the payout.
      const ticks = q.filter((x) => x.kind === 'tick');
      expect(ticks).toHaveLength(p.ticks.length);
      expect(p.ticks.length).toBe(total === 40 ? PINBALL_CAPS.ticks : 0);
      for (const tk of p.ticks) { expect(tk).toBeGreaterThan(p.rollAt!); expect(tk).toBeLessThan(p.impactAt); }
      if (p.ticks.length > 3) expect(p.ticks[p.ticks.length - 1]! - p.ticks[p.ticks.length - 2]!).toBeLessThan(p.ticks[1]! - p.ticks[0]!);
      const pays = q.filter((x) => x.kind === 'pay');
      expect(pays).toHaveLength(total === 40 ? PAYOUTS.length : 0);
      for (const py of pays) { expect(py.at).toBeGreaterThan(p.impactAt); expect(py.at).toBeLessThan(p.outAt); }
    }
  });

  it('reduced motion: no table at all; the blow lands as the formation ends', () => {
    const p = plan(40, { reduced: true });
    expect(p).toMatchObject({ reduced: true, hits: [], echoes: [], bumpers: 0, zoom: 0, shakePx: 0, dim: 0 });
    expect(p.impactAt).toBe(leadInOf([40], true));
    expect(pinballCues(p).map((q) => q.kind)).toEqual(['impact', 'end']);
    expect(tableIn(p, p.impactAt + 50)).toBe(0);
    expect(pinballPaths(p, pinballGeo({ x: 0, y: 0 }, { x: 500, y: 0 }, R, R, FRAME, C)).tracks).toHaveLength(0);
  });
});

describe('the geometry: from the two portraits, on screen in every layout', () => {
  for (const [name, a, d] of LAYOUTS) {
    it(`${name}: flipper, bumpers, lane, ramp and display are all on screen and clear of the target`, () => {
      const g = pinballGeo(a, d, R, R, FRAME, C);
      expect(g.hit).toEqual(d);
      expect(Math.hypot(g.u.x, g.u.y)).toBeCloseTo(1, 6);
      // The flipper stands in front of the striker (toward the target), its pivot and both tips on screen.
      expect(inFrame(g.pivot)).toBe(true);
      for (const ang of [g.restAng, g.upAng]) expect(inFrame({ x: g.pivot.x + Math.cos(ang) * g.batLen, y: g.pivot.y + Math.sin(ang) * g.batLen })).toBe(true);
      expect((g.pivot.x - a.x) * g.u.x + (g.pivot.y - a.y) * g.u.y).toBeGreaterThan(R);
      // Raised, the bat points more toward the target than at rest.
      expect(Math.cos(g.upAng) * g.u.x + Math.sin(g.upAng) * g.u.y).toBeGreaterThan(Math.cos(g.restAng) * g.u.x + Math.sin(g.restAng) * g.u.y);
      expect(inFrame(g.cradle, g.ballR)).toBe(true);
      expect(dist(g.cradle, a)).toBeGreaterThan(R);
      // Three bumpers, whole on screen, never over the target's lamps or each other.
      expect(g.bumpers).toHaveLength(BUMPERS);
      g.bumpers.forEach((b, i) => {
        expect(inFrame(b, g.bumperR), `bumper ${i}`).toBe(true);
        expect(dist(b, d), `bumper ${i} clear of the target`).toBeGreaterThan(R + g.bumperR);
        for (let j = 0; j < i; j++) expect(dist(b, g.bumpers[j]!)).toBeGreaterThan(g.bumperR * 2.2);
      });
      // The lane's arrows run from the flipper toward the bumpers, on the line, pointing at the target.
      // (A short lane has no room for them.)
      if (g.dist > 1000) expect(g.arrows.length).toBeGreaterThan(1);
      expect(g.arrows.length).toBeLessThanOrEqual(PINBALL_CAPS.arrows);
      for (const p of g.arrows) expect(inFrame(p, 10)).toBe(true);
      expect(g.arrowRot).toBeCloseTo(Math.atan2(d.y - a.y, d.x - a.x), 6);
      // The ramp: an even chain, on screen, with a loop (it turns right round), ending short of the bumpers. The loop stands on the outside of the bow, so it turns against it.
      const r = g.ramp;
      expect(r.n).toBeGreaterThanOrEqual(8);
      expect(r.n).toBeLessThanOrEqual(PINBALL_CAPS.rampPts);
      let turned = 0;
      for (let i = 0; i < r.n; i++) {
        expect(inFrame({ x: r.xs[i]!, y: r.ys[i]! }, g.ballR), `ramp point ${i}`).toBe(true);
        if (i > 0) {
          expect(Math.hypot(r.xs[i]! - r.xs[i - 1]!, r.ys[i]! - r.ys[i - 1]!)).toBeLessThan(r.spacing * 1.05);
          let dr = r.rot[i]! - r.rot[i - 1]!;
          while (dr > Math.PI) dr -= Math.PI * 2;
          while (dr < -Math.PI) dr += Math.PI * 2;
          turned += dr;
        }
      }
      expect(Math.abs(turned)).toBeGreaterThan(Math.PI);
      // The display is BIG (wider than three target diameters) and beside the action: nearer the target than the striker.
      expect(g.displayW).toBeGreaterThan(R * 6);
      expect(Math.hypot(g.display.x - g.hit.x, g.display.y - g.hit.y)).toBeLessThan(Math.max(g.dist * 0.5, g.displayW * 1.2));
      // The bumpers are big and the ball is one you can follow.
      expect(g.bumperR).toBeGreaterThan(R * 0.7);
      expect(g.ballR).toBeGreaterThan(R * 0.4);
      expect(Math.abs(g.tiltSign)).toBe(1);
      expect(g.fieldR).toBeGreaterThan(g.bumperR * 3);
      // The display is whole on screen.
      const hw = g.displayW / 2, hh = (g.displayW * DISPLAY_ASPECT) / 2;
      expect(g.display.x - hw).toBeGreaterThanOrEqual(0); expect(g.display.x + hw).toBeLessThanOrEqual(1920);
      expect(g.display.y - hh).toBeGreaterThanOrEqual(0); expect(g.display.y + hh).toBeLessThanOrEqual(1080);
    });
  }

  it('a small sandbox box (the Collection preview) still gets a whole table', () => {
    const f = { x0: 0, y0: 0, x1: 400, y1: 300 };
    const g = pinballGeo({ x: 70, y: 230 }, { x: 330, y: 70 }, 30, 30, f, C);
    for (const b of g.bumpers) { expect(b.x).toBeGreaterThanOrEqual(g.bumperR); expect(b.x).toBeLessThanOrEqual(400 - g.bumperR); expect(b.y).toBeGreaterThanOrEqual(g.bumperR); expect(b.y).toBeLessThanOrEqual(300 - g.bumperR); }
    expect(Number.isFinite(g.ramp.length)).toBe(true);
    const p = plan(40);
    const paths = pinballPaths(p, g);
    expect(paths.tracks[0]!.end).toBeCloseTo(p.impactAt, 6);
  });
});

describe('the balls: built once from the plan and the table', () => {
  for (const [name, a, d] of LAYOUTS) {
    it(`${name}: every ball stays on screen and ends on the target's centre, at every tier`, () => {
      const g = pinballGeo(a, d, R, R, FRAME, C);
      for (const total of TOTALS) {
        for (const seed of [1, 9, 23]) {
          const p = plan(total, { seed });
          const paths = pinballPaths(p, g);
          expect(paths.tracks).toHaveLength(p.balls);
          expect(paths.kicks).toHaveLength(p.hits.length);
          const s = newBallState();
          paths.tracks.forEach((tr, b) => {
            const land = b === 0 ? p.impactAt : p.echoes[b - 1]!;
            expect(tr.end).toBeCloseTo(land, 6);
            expect(tr.xs[tr.xs.length - 1]).toBe(d.x);
            expect(tr.ys[tr.ys.length - 1]).toBe(d.y);
            for (let i = 1; i < tr.ts.length; i++) expect(tr.ts[i]!).toBeGreaterThan(tr.ts[i - 1]!);
            for (let t = tr.ts[0]!; t < tr.end; t += 7) {
              ballAt(tr, t, s);
              expect(s.visible).toBe(true);
              expect(inFrame(s), `${total} ball ${b} @${Math.round(t - p.chargeAt)}`).toBe(true);
            }
            // Gone the moment it lands, and not there before it is in play.
            expect(ballAt(tr, tr.end, s).visible).toBe(false);
            expect(ballAt(tr, tr.ts[0]! - 1, s).visible).toBe(false);
            ballAt(tr, tr.end - 0.5, s);
            expect(dist(s, d)).toBeLessThan(40);
          });
          // The blow drives into the target along the first ball's last run.
          expect(Math.hypot(paths.blowDir.x, paths.blowDir.y)).toBeCloseTo(1, 6);
          // Each bumper is met on its rim, on the side the ball came from.
          const tr0 = paths.tracks[0]!;
          p.hits.forEach((h, i) => {
            if (h.ball !== 0) return;
            ballAt(tr0, h.at, s, 0);
            expect(dist(s, g.bumpers[h.bumper]!), `hit ${i}`).toBeCloseTo(g.bumperR * 0.92 + g.ballR, 3);
            expect(Math.hypot(paths.kicks[i]!.x, paths.kicks[i]!.y)).toBeCloseTo(1, 6);
          });
        }
      }
    });
  }

  it('I: the ball waits on the bat until the flipper fires, then flies straight at the target', () => {
    const [, a, d] = LAYOUTS[2]!;
    const g = pinballGeo(a, d, R, R, FRAME, C);
    const p = plan(3);
    const tr = pinballPaths(p, g).tracks[0]!;
    const s = newBallState();
    expect(ballAt(tr, p.strikeAt - 5, s)).toMatchObject({ x: g.cradle.x, y: g.cradle.y, vx: 0, vy: 0 });
    ballAt(tr, p.strikeAt + 60, s);
    const along = (s.vx * (d.x - g.cradle.x) + s.vy * (d.y - g.cradle.y)) / (Math.hypot(s.vx, s.vy) * dist(d, g.cradle));
    expect(along).toBeCloseTo(1, 6);
    // It pops in (no ball before the table is up, a full-size one by the strike).
    expect(ballAt(tr, p.startAt + 1, s).scale).toBeLessThan(0.2);
    expect(ballAt(tr, p.strikeAt - 5, s).scale).toBeCloseTo(1, 1);
  });

  it('III: one ball rides the ramp from its entry to its exit, and three leave the exit together', () => {
    const [, a, d] = LAYOUTS[2]!;
    const g = pinballGeo(a, d, R, R, FRAME, C);
    const p = plan(14, { seed: 5 });
    const { tracks } = pinballPaths(p, g);
    const s = newBallState(), r = g.ramp;
    expect(ballAt(tracks[0], p.rampInAt!, s)).toMatchObject({ x: r.xs[0], y: r.ys[0] });
    expect(ballAt(tracks[1], p.multiAt! - 1, s).visible).toBe(false);
    for (let b = 0; b < 3; b++) {
      ballAt(tracks[b], p.multiAt! + 0.02, s, 0);
      expect(s.visible).toBe(true);
      expect(dist(s, { x: r.xs[r.n - 1]!, y: r.ys[r.n - 1]! })).toBeLessThan(2);
      expect(s.scale).toBe(1);
    }
    // Halfway along the ride it is on the rails.
    ballAt(tracks[0], (p.rampInAt! + p.multiAt!) / 2, s);
    let near = Infinity;
    for (let i = 0; i < r.n; i++) near = Math.min(near, dist(s, { x: r.xs[i]!, y: r.ys[i]! }));
    expect(near).toBeLessThan(r.spacing);
  });
});

describe('the table at a time: the flipper, the lights, the display, the tilt, the view', () => {
  const [, a, d] = LAYOUTS[2]!;
  const g = pinballGeo(a, d, R, R, FRAME, C);

  it('the table pops up at the start and is gone by the end', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      expect(tableIn(p, p.startAt - 1)).toBe(0);
      expect(tableIn(p, p.strikeAt)).toBeCloseTo(1, 1);
      expect(tableIn(p, p.outAt)).toBeCloseTo(1, 2);
      expect(tableIn(p, p.endAt)).toBeCloseTo(0, 6);
    }
  });

  it('the flipper rests, is halfway up exactly as it meets the ball, tops out, and drops back to rest', () => {
    const p = plan(8);
    expect(flipperAngle(p, g, p.strikeAt - 200)).toBe(g.restAng);
    const frac = (t: number): number => (flipperAngle(p, g, t) - g.restAng) / (g.upAng - g.restAng);
    expect(frac(p.strikeAt)).toBeGreaterThan(0.5);
    expect(frac(p.strikeAt + p.swingMs)).toBeCloseTo(1, 6);
    expect(frac(p.strikeAt + 700)).toBeCloseTo(0, 6);
  });

  it('a bumper lights and kicks when it is hit, and only then (II)', () => {
    const p = plan(8, { seed: 3 });
    const paths = pinballPaths(p, g);
    const s = newBumperState();
    const h = p.hits[0]!;
    const other = (h.bumper + 1) % BUMPERS === p.hits[1]!.bumper ? (h.bumper + 2) % BUMPERS : (h.bumper + 1) % BUMPERS;
    expect(bumperAt(p, g, paths, h.bumper, h.at - 5, 9, s)).toMatchObject({ lit: false, x: g.bumpers[h.bumper]!.x, y: g.bumpers[h.bumper]!.y });
    bumperAt(p, g, paths, h.bumper, h.at + 20, 9, s);
    expect(s.lit).toBe(true);
    expect(dist(s, g.bumpers[h.bumper]!)).toBeGreaterThan(2);
    expect(dist(s, g.bumpers[h.bumper]!)).toBeLessThanOrEqual(9.01);
    expect(s.scale).toBeGreaterThan(1);
    expect(bumperAt(p, g, paths, other, h.at + 20, 9, s).lit).toBe(false);
    // All three flash together on the impact, and none stand on I.
    for (let i = 0; i < BUMPERS; i++) expect(bumperAt(p, g, paths, i, p.impactAt + 40, 9, s).lit).toBe(true);
    const p1 = plan(3);
    for (let i = 0; i < BUMPERS; i++) expect(bumperAt(p1, g, pinballPaths(p1, g), i, p1.strikeAt, 9, s).alpha).toBe(0);
  });

  it('IV: the lights chase one at a time before the flip, and strobe through the roll-up', () => {
    const p = plan(40);
    const paths = pinballPaths(p, g);
    const s = newBumperState();
    for (let t = p.chaseAt! + 5; t < p.strikeAt; t += 31) {
      expect([0, 1, 2].filter((i) => bumperAt(p, g, paths, i, t, 9, s).lit)).toHaveLength(1);
      expect([0, 1, 2, 3, 4].filter((j) => arrowLit(p, j, 5, t))).toHaveLength(1);
    }
    const seen = new Set<string>();
    for (let t = p.rollAt! + 1; t < p.impactAt; t += 35) seen.add([0, 1, 2].map((i) => (bumperAt(p, g, paths, i, t, 9, s).lit ? 1 : 0)).join(''));
    expect(seen.has('101') && seen.has('010')).toBe(true);
    expect(lampAt(p, p.impactAt + 10).lit).toBe(true);
    expect(lampAt(plan(3), plan(3).strikeAt).lit).toBe(false);
    expect(arrowLit(p, 0, 0, p.strikeAt)).toBe(false);
  });

  it('the ramp lights up entry first before the flipper fires, and goes after the split (III only)', () => {
    const p = plan(14);
    expect(rampAt(p, p.startAt)).toEqual({ reveal: 0, alpha: 0 });
    const mid = rampAt(p, p.startAt + 270);
    expect(mid.reveal).toBeGreaterThan(0); expect(mid.reveal).toBeLessThan(1);
    expect(rampAt(p, p.strikeAt)).toEqual({ reveal: 1, alpha: 1 });
    expect(rampAt(p, p.multiAt! + 700).alpha).toBe(0);
    expect(rampAt(plan(40), plan(40).strikeAt).alpha).toBe(0);
  });

  it('the display: MULTIBALL on III; on IV TILT blinks, then JACKPOT over the score', () => {
    const p3 = plan(14);
    expect(displayAt(p3, p3.multiAt! - 200).alpha).toBe(0);
    expect(displayAt(p3, p3.multiAt! + 300)).toMatchObject({ word: 'multiball', score: false });
    expect(displayAt(p3, p3.endAt + 300).alpha).toBe(0);
    const p = plan(40);
    expect(displayAt(p, p.tiltAt! - 100).alpha).toBe(0);
    const blink = new Set<boolean>();
    for (let t = p.tiltAt!; t < p.rollAt!; t += 20) { const s = displayAt(p, t); expect(s.word).toBe('tilt'); blink.add(s.wordOn); }
    expect(blink.size).toBe(2);
    expect(displayAt(p, p.rollAt! + 10)).toMatchObject({ word: 'jackpot', wordOn: true, score: true });
    expect(displayAt(p, p.impactAt + 200).score).toBe(true);
    for (const total of [3, 8]) expect(displayAt(plan(total), plan(total).impactAt).alpha).toBe(0);
  });

  it('THE JACKPOT ROLLS UP to the damage of the blow: from 0, never falling, never past it, exactly it on the impact', () => {
    for (const total of [20, 23, 40, 57, 99, 100, 137, 2, 7]) {
      const p = plan(total, { knockout: total < 20, seed: total });
      const cells = jackpotCells(total);
      expect(cells).toBe(Math.max(2, String(total).length));
      const read = (t: number): string => jackpotDigits(p, t, []).join('');
      expect(read(p.impactAt), `total ${total}`).toBe(String(total).padStart(cells, '0'));
      expect(Number(read(p.impactAt + 400))).toBe(total);
      expect(jackpotValue(p, p.rollAt!)).toBe(0);
      // It only ever climbs, it is short of the damage until the impact, and every reading is the right width.
      let prev = 0;
      const seen = new Set<number>();
      for (let t = p.rollAt!; t < p.impactAt - 0.5; t += 10) {
        const v = jackpotValue(p, t);
        expect(v, `total ${total} at ${t}`).toBeGreaterThanOrEqual(prev);
        expect(v).toBeLessThan(total);
        expect(read(t)).toHaveLength(cells);
        expect(Number(read(t))).toBe(v);
        prev = v; seen.add(v);
      }
      if (total >= 20) expect(seen.size).toBeGreaterThan(8);
      // Halfway through it is well short (it races at the end).
      expect(jackpotValue(p, (p.rollAt! + p.impactAt) / 2)).toBeLessThan(total * 0.5);
    }
    // A reused array is rewritten in place.
    const out: number[] = [9, 9, 9, 9];
    expect(jackpotDigits(plan(40), plan(40).impactAt, out)).toBe(out);
    expect(out).toEqual([4, 0]);
  });

  it('the tilt: five degrees one way (a tilt you can see), a smaller rock back, level at both ends, never past the dial; only on IV', () => {
    expect(C.tiltDeg).toBeGreaterThanOrEqual(4);
    const p = plan(40);
    const max = (C.tiltDeg * Math.PI) / 180;
    expect(tiltAt(p, C, p.tiltAt!)).toBe(0);
    expect(tiltAt(p, C, p.tiltEnd!)).toBe(0);
    expect(tiltAt(p, C, p.tiltAt! - 50)).toBe(0);
    let hi = 0, lo = 0;
    for (let t = p.tiltAt!; t <= p.tiltEnd!; t += 4) { const v = tiltAt(p, C, t); hi = Math.max(hi, v); lo = Math.min(lo, v); }
    expect(hi).toBeGreaterThan(max * 0.8);
    expect(hi).toBeLessThanOrEqual(max * 1.02);
    expect(lo).toBeLessThan(-max * 0.1);
    expect(lo).toBeGreaterThan(-max * 0.6);
    for (const total of [3, 8, 14]) { const q = plan(total); for (let t = q.chargeAt; t < q.endAt; t += 40) expect(tiltAt(q, C, t)).toBe(0); }
    expect(tiltAt(p, { ...C, tiltDeg: 0 }, p.tiltAt! + 100)).toBeCloseTo(0, 9);
  });

  it('the striker leans back, jolts forward with the flip, and (IV) shoves the table sideways as it tilts', () => {
    const p = plan(40);
    expect(strikerPose(p, p.strikeAt - 20, R).along).toBeLessThan(0);
    expect(strikerPose(p, p.strikeAt + 4, R).along).toBeGreaterThan(R * 0.1);
    expect(strikerPose(p, p.tiltAt! - 4, R).across).toBe(0);
    expect(Math.abs(strikerPose(p, p.tiltAt! + 4, R).across)).toBeGreaterThan(R * 0.2);
    const end = strikerPose(p, p.endAt, R);
    expect(Math.abs(end.along) + Math.abs(end.across) + Math.abs(end.rot)).toBeLessThan(0.5);
  });

  it('the view: still before the flip, pushed in while the ball is in play, punched on the impact, back to rest by the end', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      const dir = { x: 0.6, y: -0.8 };
      expect(pinballCameraAt(p, C, p.strikeAt - 1, dir)).toEqual({ zoom: 1, x: 0, y: 0 });
      expect(pinballCameraAt(p, C, p.impactAt - 1, dir).zoom).toBeCloseTo(1 + p.zoom, 3);
      expect(pinballCameraAt(p, C, p.impactAt + 1, dir).zoom).toBeGreaterThan(1 + p.zoom);
      const end = pinballCameraAt(p, C, p.endAt + 600, dir);
      expect(end.zoom).toBeCloseTo(1, 3);
      for (let t = p.chargeAt; t < p.endAt; t += 9) { const c = pinballCameraAt(p, C, t, dir); expect(Math.hypot(c.x, c.y)).toBeLessThanOrEqual(PINBALL_CAPS.shakePx * 1.7); }
    }
  });
});

function manualFrames(): { frames: HeroPinballOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function tickTo(r: { h: { elapsed(): number; done: boolean }; f: { tick: (ms: number, step?: number) => void } }, t: number, step = 4): void {
  for (let i = 0; i < 20000 && !r.h.done && r.h.elapsed() < t; i++) r.f.tick(step, step);
}

function run(over: Partial<HeroPinballOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  attackerEl.style.transform = 'translateX(3px)';
  attackerEl.style.opacity = '0.95';
  defenderEl.style.transform = 'translateY(2px)';
  defenderEl.style.filter = 'brightness(1.1)';
  camera.append(attackerEl, defenderEl);
  document.body.append(host, camera);
  const h = playHeroPinball({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: { x: 170, y: 850 }, defender: { x: 1773, y: 161 }, defenderRadius: R, attackerRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

/** Both portraits and the page are back EXACTLY as they were, and nothing of the attack is left drawing. */
function expectRestored(r: ReturnType<typeof run>, zClass = 'duel-attacker-player'): void {
  expect(r.attackerEl.style.transform).toBe('translateX(3px)');
  expect(r.attackerEl.style.opacity).toBe('0.95');
  expect(r.defenderEl.style.transform).toBe('translateY(2px)');
  expect(r.defenderEl.style.filter).toBe('brightness(1.1)');
  expect(r.defenderEl.style.opacity).toBe('');
  expect(r.camera.style.transform).toBe('');
  expect(document.body.classList.contains(zClass)).toBe(false);
  expect(r.host.querySelector('.hblast')).toBeNull();
  expect(r.h.scene?.ownVisible ?? false).toBe(false);
  expect(r.h.scene?.tiltRad ?? 0).toBe(0);
}

describe('the runner (the shared clock, both portraits restored on every exit)', () => {
  afterEach(() => { document.body.innerHTML = ''; document.body.className = ''; });

  it('IV: nothing before the impact touches the target; the blow lands ONCE as the jackpot stops on the damage; everything is put back EXACTLY', () => {
    const r = run({ total: 40, formation: formationOf([40], 40) });
    const { h, f, onImpact, onDone } = r;
    expect(r.host.querySelector('.hblast.hpinball')).not.toBeNull();
    let tilted = 0;
    for (let i = 0; i < 4000 && h.elapsed() < h.plan.impactAt - 8; i++) {
      f.tick(4, 4);
      const t = h.elapsed();
      // Outside the tilt, the struck portrait is untouched until the ball lands (the tilt turns the whole table, it too).
      if (t < h.plan.tiltAt! || (t > h.plan.tiltEnd! && t < h.plan.impactAt)) expect(r.defenderEl.style.transform, `before the impact @${Math.round(t)}`).toBe('translateY(2px)');
      if (Math.abs(h.scene!.tiltRad) > 0.005) {
        tilted++;
        // The scene's own root, the striker and the target all turn by the same angle; the game's stage is never rotated.
        expect(t).toBeGreaterThan(h.plan.tiltAt!); expect(t).toBeLessThan(h.plan.tiltEnd!);
        const deg = ((h.scene!.tiltRad * 180) / Math.PI).toFixed(2);
        expect(r.defenderEl.style.transform).toContain(`rotate(${deg}deg)`);
        expect(r.attackerEl.style.transform).toContain('rotate(');
        expect(r.camera.style.transform).not.toContain('rotate');
      }
    }
    expect(tilted).toBeGreaterThan(20);
    expect(onImpact).not.toHaveBeenCalled();
    expect(document.body.classList.contains('duel-attacker-player')).toBe(true);
    expect(h.scene!.ownVisible).toBe(true);
    expect(h.digits(h.plan.impactAt - 300).join('')).not.toBe('40');
    tickTo(r, h.plan.impactAt + 12);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.digits(h.elapsed()).join('')).toBe('40');
    expect(r.host.querySelector('.hblast-hit')!.textContent).toBe('-40');
    expect(r.defenderEl.style.transform).toContain('translate(');
    expect(h.ball(0, h.elapsed()).visible).toBe(false);
    tickTo(r, h.plan.endAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
    f.tick(4000, 16);
    expect(f.hooked()).toBe(0);
    expect(r.root.children).toHaveLength(0);
  });

  it('III: the blow lands with the FIRST ball; the two echoes land nothing more', () => {
    const r = run({ total: 14, formation: formationOf([14], 14) });
    tickTo(r, r.h.plan.impactAt - 6);
    expect(r.onImpact).not.toHaveBeenCalled();
    expect(r.defenderEl.style.transform).toBe('translateY(2px)');
    tickTo(r, r.h.plan.impactAt + 6);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expect(r.h.ball(1, r.h.elapsed()).visible).toBe(true);
    tickTo(r, r.h.plan.echoes[1]! + 30);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    tickTo(r, r.h.plan.endAt + 40, 8);
    expectRestored(r);
  });

  it('cancel() mid-run, finish() mid-rattle and the safety timer each put everything back exactly (cancel never lands)', () => {
    const a = run({ total: 40, formation: formationOf([40], 40) });
    tickTo(a, a.h.plan.tiltAt! + 120);
    expect(a.attackerEl.style.transform).toContain('rotate(');
    expect(a.h.scene!.tiltRad).not.toBe(0);
    a.h.cancel();
    expect(a.onImpact).not.toHaveBeenCalled();
    expectRestored(a);
    expect(a.f.hooked()).toBe(0);
    document.body.innerHTML = '';

    const b = run({ total: 8, formation: formationOf([8], 8), side: 'opp', attacker: { x: 1773, y: 161 }, defender: { x: 170, y: 850 } });
    tickTo(b, b.h.plan.hits[2]!.at + 10);
    expect(document.body.classList.contains('duel-attacker-opp')).toBe(true);
    b.h.finish();
    expect(b.onImpact).toHaveBeenCalledTimes(1);
    expectRestored(b, 'duel-attacker-opp');
    document.body.innerHTML = '';

    vi.useFakeTimers();
    try {
      const c = run({ total: 40, formation: formationOf([40], 40), safety: true });
      tickTo(c, c.h.plan.tiltAt! + 100);
      vi.advanceTimersByTime(c.h.plan.endAt + 3000);
      expect(c.onImpact).toHaveBeenCalledTimes(1);
      expect(c.h.done).toBe(true);
      expectRestored(c);
    } finally { vi.useRealTimers(); }
  });

  it('an unmount at any moment (Recruit cancels the handle) leaves no transform, no class and nothing drawn, at every tier', () => {
    for (const total of TOTALS) {
      for (const frac of [0.1, 0.35, 0.6, 0.85, 0.98]) {
        const r = run({ total, formation: formationOf([total], total) });
        tickTo(r, r.h.plan.chargeAt + (r.h.plan.endAt - r.h.plan.chargeAt) * frac);
        r.h.cancel();
        expectRestored(r);
        expect(r.f.hooked()).toBe(0);
        expect(r.root.children, `${total} @${frac}`).toHaveLength(0);
        document.body.innerHTML = '';
      }
    }
  });

  it('both directions at every tier: within the sprite cap, the blow once, ends on time, a replay is identical; reduced motion', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of TOTALS) {
        const a = side === 'player' ? { x: 170, y: 850 } : { x: 1773, y: 161 };
        const d = side === 'player' ? { x: 1773, y: 161 } : { x: 170, y: 850 };
        const r = run({ total, formation: formationOf([total], total), side, attacker: a, defender: d, rollSeed: 4242 });
        let peak = 0;
        while (!r.h.done && r.h.elapsed() < 20000) { r.f.tick(8, 8); peak = Math.max(peak, r.h.scene!.liveSprites); }
        expect(peak, `${side} ${total}`).toBeLessThanOrEqual(MAX_PINBALL_SPRITES);
        expect(peak).toBeGreaterThan(3);
        expect(r.onImpact).toHaveBeenCalledTimes(1);
        expect(r.h.elapsed()).toBeLessThanOrEqual(r.h.plan.endAt + 16);
        expectRestored(r, side === 'opp' ? 'duel-attacker-opp' : 'duel-attacker-player');
        const again = run({ total, formation: formationOf([total], total), side, attacker: a, defender: d, rollSeed: 4242 });
        expect(again.h.plan).toEqual(r.h.plan);
        expect(again.h.paths).toEqual(r.h.paths);
        again.h.cancel();
        document.body.innerHTML = '';
      }
    }
    const red = run({ total: 40, formation: formationOf([40], 40), reduced: true });
    expect(red.h.scene).toBeNull();
    red.f.tick(6000, 16);
    expect(red.onImpact).toHaveBeenCalledTimes(1);
    expect(red.attackerEl.style.transform).toBe('translateX(3px)');
    expect(red.defenderEl.style.transform).toBe('translateY(2px)');
  });

  it('the camera reaches the FX once: mirrored only when the canvas does not ride it', () => {
    const r = run({ total: 40, formation: formationOf([40], 40) });
    tickTo(r, r.h.plan.strikeAt + 300);
    expect(r.h.mirrorsCamera).toBe(true); // this test's canvas is not inside the camera element
    expect(r.camera.style.transform).toContain('scale(');
    r.h.cancel();
  });
});

describe('the scene', () => {
  const geo = pinballGeo({ x: 170, y: 850 }, { x: 1773, y: 161 }, R, R, FRAME, C);
  const mk = (): HeroPinballScene => {
    const s = new HeroPinballScene(TEX, { flash: 0xffffff, lamp: 0xffc13a, spark: 0xcfe6ff, side: 0xffcf5a }, 1, R, R, 1, 7);
    s.placeTable(geo);
    return s;
  };

  it('its own objects show only when written, and hideOwn() hides them all and levels the root', () => {
    const s = mk();
    expect(s.ownVisible).toBe(false);
    s.setFlipper(geo.restAng, 1);
    s.setBall(0, { visible: true, x: 500, y: 500, vx: 2, vy: 0, scale: 1 });
    s.setBumper(1, { x: 600, y: 300, scale: 1, lit: true, alpha: 1 });
    s.setLamps(1, true, 3);
    s.setArrow(0, 1, true);
    s.setRamp(0.5, 1);
    s.setDisplay({ alpha: 1, scale: 1, word: 'jackpot', wordOn: true, score: true }, [4, 0]);
    s.setTilt(0.04, geo.hit);
    s.refresh();
    expect(s.ownVisible).toBe(true);
    expect(s.root.rotation).toBeCloseTo(0.04, 9);
    // The tilt turns the scene about the target: the target's own point does not move.
    const at = s.root.toGlobal(geo.hit);
    expect(at.x).toBeCloseTo(geo.hit.x, 3); expect(at.y).toBeCloseTo(geo.hit.y, 3);
    s.hideOwn();
    expect(s.ownVisible).toBe(false);
    expect(s.root.rotation).toBe(0);
    expect(s.root.position.x).toBe(0); expect(s.root.pivot.x).toBe(0);
    s.destroy();
  });

  it('the tilt composes with the camera mirror and comes back to exactly the camera', () => {
    const s = mk();
    s.setCamera(-30, 12, 1.05);
    s.setTilt(0.03, geo.hit);
    const g1 = s.root.toGlobal(geo.hit);
    expect(g1.x).toBeCloseTo(-30 + 1.05 * geo.hit.x, 3);
    expect(g1.y).toBeCloseTo(12 + 1.05 * geo.hit.y, 3);
    s.setTilt(0, geo.hit);
    expect([s.root.position.x, s.root.position.y, s.root.scale.x, s.root.rotation, s.root.pivot.x]).toEqual([-30, 12, 1.05, 0, 0]);
    s.destroy();
  });

  it('every effect stays under the cap and drains; destroy leaves nothing', () => {
    const s = mk();
    for (let i = 0; i < 40; i++) {
      s.flip(geo.cradle, geo.u, 1.4);
      s.bump(geo.bumpers[i % 3]!, geo.bumpers[i % 3]!, i % 2 ? 10 : 50, true);
      s.rail(geo.cradle); s.split(geo.cradle);
      s.impact(geo.hit, geo.u, { burst: 1.8, rings: 4, big: true });
      s.echo(geo.hit, geo.u); s.jackpot(); s.popAt(geo.pivot, 40); s.payout(i); s.screenFlash(0.4, 1920, 1080);
    }
    expect(s.liveSprites).toBeLessThanOrEqual(MAX_PINBALL_SPRITES);
    for (let i = 0; i < 400; i++) s.update(16);
    expect(s.liveFx).toBe(0);
    expect(s.update(16)).toBe(false);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
    s.setFlipper(0, 1); s.setTilt(0.1, geo.hit); s.setBall(0, newBallState()); s.setPlayfield(1, 1); // safe after destroy
  });
});
