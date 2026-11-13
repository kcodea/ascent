// @vitest-environment jsdom
/**
 * THE WRESTLING HERO ATTACK ("Top Rope", a Legendary, dev-only: no cosmetic yet): the shared tiers onto the four moves;
 * the tuner values and the sounds; the pure plan (the blow lands ONCE: the chop, the slam, the elbow, the clothesline;
 * the shove, the ropes, the landings, the count and the bell are ticks); the geometry (every spot on screen, in both
 * directions and from the corners; the one exception is III's exit through the top); the pure poses of BOTH portraits;
 * the ring ropes, the spotlight, the elbow star and the shadow; the runner (both portraits' transforms, the striker's
 * opacity and the z-order restored exactly on the end, finish, cancel and the safety timer; the ring, the light, the
 * star and the shadow hidden; the camera applied once; the clock never changes speed); the scene.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES } from '../heroBlast/heroAttackStyle';
import {
  HERO_WRESTLE_CLIP_KEYS, HERO_WRESTLE_DEFAULTS, HERO_WRESTLE_RANGES, clampHeroWrestleValue, heroWrestleConfigJson, onScreen, ringLayout, strikerPose,
  victimPose, wrestleCameraAt, wrestleCues, wrestleElbow, wrestleGeo, wrestleKind, wrestlePlan, wrestleRing, wrestleShadow, wrestleSpot,
  type HeroWrestleNumKey, type WrestleCtx,
} from './heroWrestleConfig';
import { HeroWrestleScene, MAX_WRESTLE_SPRITES, type HeroWrestleTextures } from './heroWrestleScene';
import { playHeroWrestle, type HeroWrestleOptions } from './heroWrestle';
import { WRESTLE_COUNTS, WRESTLE_WORDS } from './heroWrestleTextures';
import { SPEC } from '../HeroWrestleTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroWrestleTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  rope: W, post: W, cone: W, hand: W, arc: W, impact: W, puff: W, shadow: W, bell: W, wordWoo: W, wordSlam: W, wordWinner: W, num1: W, num2: W, num3: W,
};
const C = HERO_WRESTLE_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean } = {}) => wrestlePlan({ total, leadIn: leadInOf([total], o.reduced), ...o }, C);
const A = { x: 300, y: 860 }, D = { x: 1620, y: 220 };
const R = 80;
const FRAME = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
const ctxOf = (total: number, a = A, d = D, frame = FRAME, o: { knockout?: boolean } = {}): WrestleCtx => {
  const p = plan(total, o);
  return { p, g: wrestleGeo(a, d, R, R, frame, p.kind, C), c: C, a, d, aR: R, dR: R };
};
const TOTALS = [3, 8, 14, 40] as const; // I, II, III, IV
const cueKinds = (total: number) => wrestleCues(plan(total)).map((q) => q.kind);
const at = (slot: { x: number; y: number }, p: { x: number; y: number }) => ({ x: slot.x + p.x, y: slot.y + p.y });
const dist = (p: { x: number; y: number }, q: { x: number; y: number }): number => Math.hypot(p.x - q.x, p.y - q.y);

describe('the tiers: the shared four onto the four moves', () => {
  it('uses the shared thresholds; I the chop, II the body slam, III the elbow drop, IV the finisher; a knockout plays the finisher', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).kind, `dmg ${d}`).toBe(wrestleKind(tierOf(d)));
    expect([1, 2, 3, 4].map((t) => wrestleKind(t as 1 | 2 | 3 | 4))).toEqual(['chop', 'slam', 'elbow', 'pin']);
    expect(plan(2, { knockout: true })).toMatchObject({ tier: 4, kind: 'pin' });
    expect(wrestleCues(plan(2, { knockout: true })).map((q) => q.kind)).toEqual(expect.arrayContaining(['whip', 'rope', 'count', 'bell']));
  });

  it('is a dev-only style (in the style list and the dev override)', () => {
    expect(HERO_ATTACK_STYLES).toContain('wrestle');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('wrestle');
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; buttons on top; a clip row per sound', () => {
    for (const [k, [min, max]] of Object.entries(HERO_WRESTLE_RANGES)) {
      const v = C[k as HeroWrestleNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroWrestleValue('flipTurns', 99)).toBe(3);
    expect(clampHeroWrestleValue('colorMat', 'nope')).toBe(C.colorMat);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroWrestleConfigJson(C)).previewDamage).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    expect((SPEC.actions ?? []).map((a) => a.label).filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
    for (const k of HERO_WRESTLE_CLIP_KEYS) {
      expect(keys.has(k as never), k).toBe(true);
      expect(keys.has(k.replace('Clip', 'Gain') as never), k).toBe(true);
      expect(keys.has(k.replace('Clip', 'Rate') as never), k).toBe(true);
    }
  });

  it('the sounds: the chop, the mat slam, the bell and the crowd are its own clips; every default clip exists', async () => {
    expect(C.sfxChopClip).toBe('fx/wrestle-chop');
    expect(C.sfxSlamClip).toBe('fx/wrestle-slam');
    expect(C.sfxBellClip).toBe('fx/wrestle-bell');
    expect(C.sfxWooClip).toBe('fx/wrestle-woo');
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const k of HERO_WRESTLE_CLIP_KEYS) {
      const id = C[k];
      const base = resolve(__dirname, '../audio', id);
      expect(existsSync(`${base}.mp3`) || existsSync(`${base}.wav`), `${k} = ${id}`).toBe(true);
    }
  });

  it('the words on screen are short and plain', () => {
    for (const w of [...WRESTLE_WORDS, ...WRESTLE_COUNTS]) {
      expect(w.length).toBeLessThanOrEqual(7);
      expect(w).not.toMatch(/—|--|oath|climb/i);
    }
  });
});

describe('the plan (the striker walks in; the blow lands once)', () => {
  it('every tier: the walk, the grip, then the move; exactly one impact cue; the charge first and the end last; in time order', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      expect(p.chargeAt).toBeLessThan(p.walkAt);
      expect(p.walkAt).toBeLessThan(p.gripAt);
      expect(p.gripAt).toBeLessThan(p.impactAt);
      expect(p.impactAt).toBeLessThan(p.homeAt);
      expect(p.homeAt).toBeLessThan(p.homeEnd);
      expect(p.homeEnd).toBeLessThanOrEqual(p.endAt);
      const cs = wrestleCues(p);
      expect(cs.filter((q) => q.kind === 'impact')).toHaveLength(1);
      expect(cs[0]!.kind).toBe('charge');
      expect(cs[cs.length - 1]!.kind).toBe('end');
      for (let i = 1; i < cs.length; i++) expect(cs[i]!.at).toBeGreaterThanOrEqual(cs[i - 1]!.at);
    }
  });

  it('I THE CHOP: a wind-up, then the arm comes through = THE impact; the shortest of the four', () => {
    const p = plan(3);
    expect(p.chopAt! - p.gripAt).toBe(C.chopWindMs);
    expect(p.impactAt - p.chopAt!).toBe(C.chopMs);
    expect(cueKinds(3)).toEqual(['charge', 'walk', 'grip', 'swing', 'impact', 'home', 'end']);
    expect(p.endAt - p.chargeAt).toBeLessThan(plan(8).endAt - plan(8).chargeAt);
  });

  it('II THE BODY SLAM: the dip, the lift, a held beat at the top, the slam = THE impact, then one bounce (a tick)', () => {
    const p = plan(8);
    expect(p.gripAt).toBeLessThan(p.liftAt!);
    expect(p.liftAt!).toBeLessThan(p.topAt!);
    expect(p.slamAt! - p.topAt!).toBe(C.hangMs);
    expect(p.impactAt).toBeGreaterThan(p.slamAt!);
    expect(p.bounceEnd!).toBeGreaterThan(p.impactAt);
    expect(p.homeAt).toBeGreaterThan(p.bounceEnd!);
    expect(cueKinds(8)).toEqual(['charge', 'walk', 'grip', 'lift', 'top', 'drop', 'impact', 'bounce', 'home', 'end']);
  });

  it('III THE ELBOW DROP: the shove flat, the climb out of the top, a held beat, the dive = THE impact', () => {
    const p = plan(14);
    expect(p.downAt! - p.gripAt).toBe(C.shoveMs);
    expect(p.perchAt! - p.downAt!).toBe(C.climbMs);
    expect(p.diveAt! - p.perchAt!).toBe(C.perchMs);
    expect(p.impactAt - p.diveAt!).toBe(C.diveMs);
    expect(cueKinds(14)).toEqual(['charge', 'walk', 'grip', 'down', 'perch', 'dive', 'impact', 'home', 'end']);
  });

  it('IV THE FINISHER: the whip, the ropes, flung back, the clothesline = THE impact; then the landing, the cover, 1 2 3 and the bell (all ticks)', () => {
    const p = plan(40);
    expect(p.kind).toBe('pin');
    expect(p.whipAt!).toBeLessThan(p.ropeAt!);
    expect(p.ropeAt!).toBeLessThan(p.flingAt!);
    expect(p.flingAt!).toBeLessThan(p.impactAt);
    expect(p.impactAt).toBeLessThan(p.landAt!);
    expect(p.landAt!).toBeLessThan(p.pinAt!);
    expect(p.counts).toHaveLength(3);
    expect(p.counts[0]!).toBeGreaterThan(p.pinAt!);
    expect(p.counts[1]! - p.counts[0]!).toBe(C.countMs);
    expect(p.bellAt!).toBeGreaterThan(p.counts[2]!);
    expect(p.homeAt).toBeGreaterThan(p.bellAt!);
    const k = cueKinds(40);
    expect(k).toEqual(['charge', 'walk', 'grip', 'whip', 'rope', 'fling', 'impact', 'land', 'cover', 'count', 'count', 'count', 'bell', 'home', 'end']);
    // The whole finisher stays in the range of the other four-tier attacks (about four seconds).
    expect(p.endAt - p.chargeAt).toBeLessThan(4600);
  });

  it('no hit-stop and no slow motion: the plan carries no hold', () => {
    for (const total of TOTALS) expect(Object.keys(plan(total)).join(' ')).not.toMatch(/hitStop|slow|freeze/i);
  });

  it('reduced motion: no pose, no ring, no light; the blow lands at the end of the formation', () => {
    const p = plan(40, { reduced: true });
    expect(p.reduced).toBe(true);
    expect(wrestleCues(p).map((q) => q.kind)).toEqual(['impact', 'end']);
    const x: WrestleCtx = { p, g: wrestleGeo(A, D, R, R, FRAME, p.kind, C), c: C, a: A, d: D, aR: R, dR: R };
    for (let t = 0; t < p.endAt; t += 50) {
      expect(strikerPose(x, t)).toMatchObject({ x: 0, y: 0, rot: 0, squash: 0 });
      expect(victimPose(x, t)).toMatchObject({ x: 0, y: 0, rot: 0, squash: 0 });
      expect(wrestleRing(x, t).visible).toBe(false);
      expect(wrestleSpot(x, t).visible).toBe(false);
      expect(wrestleElbow(x, t).visible).toBe(false);
    }
    expect(wrestleCameraAt(p, C, 1000, { x: 0, y: 1 })).toEqual({ zoom: 1, x: 0, y: 0 });
  });
});

/** Layouts: the usual diagonal (both ways), stacked, side by side, and both tucked hard into opposite corners. */
const LAYOUTS: [string, { x: number; y: number }, { x: number; y: number }][] = [
  ['you strike (bottom left -> top right)', A, D],
  ['foe strikes (top right -> bottom left)', D, A],
  ['stacked', { x: 960, y: 900 }, { x: 960, y: 200 }],
  ['stacked, flipped', { x: 960, y: 200 }, { x: 960, y: 900 }],
  ['side by side', { x: 400, y: 540 }, { x: 1500, y: 540 }],
  ['corners', { x: 140, y: 920 }, { x: 1800, y: 110 }],
  ['corners, flipped', { x: 1800, y: 110 }, { x: 140, y: 920 }],
];

describe('the geometry', () => {
  it('the striker stands BESIDE the struck portrait, on the side it came from, about two radii away and level with it', () => {
    const g = wrestleGeo(A, D, R, R, FRAME, 'chop', C);
    expect(g.s).toBe(-1); // it came from the left
    expect(g.grab.y).toBe(D.y);
    expect(D.x - g.grab.x).toBeCloseTo(2 * R * C.gap, 5);
    expect(wrestleGeo(D, A, R, R, FRAME, 'chop', C).s).toBe(1);
    // Stacked: the roomier side. Tucked against the right edge: the left.
    expect(wrestleGeo({ x: 1800, y: 900 }, { x: 1800, y: 200 }, R, R, FRAME, 'chop', C).s).toBe(-1);
  });

  it('II: the struck portrait is held ABOVE the striker and slammed down beside it; III: the dive starts off the top, straight above the mat', () => {
    const s = wrestleGeo(A, D, R, R, FRAME, 'slam', C);
    expect(s.top.y).toBeLessThan(s.stand.y - R * 1.2);
    expect(Math.abs(s.top.x - s.stand.x)).toBeLessThan(R * 0.5);
    expect(s.mat.y).toBeGreaterThan(s.top.y + R * 1.2);
    expect(Math.abs(s.mat.x - s.stand.x)).toBeGreaterThan(R);
    const e = wrestleGeo(A, D, R, R, FRAME, 'elbow', C);
    expect(e.sky.y).toBeLessThan(-R);
    expect(e.sky.x).toBe(e.mat.x);
    expect(e.cover.y).toBeLessThan(e.mat.y);
  });

  it('IV: the ring fits the screen; the struck slot is by the near ropes, the whip goes PAST the striker to the far ropes, which stretch OUT', () => {
    for (const [name, a, d] of LAYOUTS) {
      const g = wrestleGeo(a, d, R, R, FRAME, 'pin', C);
      const { ring } = g;
      expect(ring.half, name).toBeGreaterThan(R * 2);
      for (const x of [ring.xNear, ring.xFar]) { expect(x, name).toBeGreaterThan(0); expect(x, name).toBeLessThan(1920); }
      expect(Math.abs(d.x - ring.xNear), name).toBeLessThan(Math.abs(d.x - ring.xFar));
      // the striker (at `grab`) is between the struck slot and the far ropes
      expect((g.grab.x - d.x) * g.s, name).toBeGreaterThan(0);
      expect((ring.xFar - g.grab.x) * g.s, name).toBeGreaterThan(0);
      // the ropes stretch outward, away from the middle of the ring
      expect((g.ropeMax.x - g.ropeHit.x) * g.s, name).toBeCloseTo(R * C.stretch, 5);
      // the clothesline: the striker braced on the near side of where they meet
      expect((g.meet.x - g.block.x) * g.s, name).toBeGreaterThan(0);
      const [near, far] = ringLayout(g, R, R);
      expect(near.out, name).toBe(-g.s);
      expect(far.out, name).toBe(g.s);
      for (const sd of [near, far]) for (const pt of [sd.back, sd.front]) expect(onScreen(pt, FRAME, 0), `${name} post`).toBe(true);
    }
  });

  it('every layout, every tier, 1920 x 1080 and 1600 x 900: every spot a portrait is sent to is on screen (III\'s exit through the top is the one exception)', () => {
    for (const fr of [FRAME, { x0: 0, y0: 0, x1: 1600, y1: 900 }]) {
      const k = fr.x1 / 1920;
      for (const [name, a0, d0] of LAYOUTS) {
        const a = { x: a0.x * k, y: a0.y * k }, d = { x: d0.x * k, y: d0.y * k };
        for (const kind of ['chop', 'slam', 'elbow', 'pin'] as const) {
          const g = wrestleGeo(a, d, R, R, fr, kind, C);
          for (const [label, pt] of Object.entries({ grab: g.grab, stagger: g.stagger, under: g.under, stand: g.stand, top: g.top, mat: g.mat, cover: g.cover, ropeHit: g.ropeHit, ropeMax: g.ropeMax, block: g.block, meet: g.meet, win: g.win, count: g.count })) {
            expect(onScreen(pt, fr, R * 0.4), `${name} ${kind} ${label} (${Math.round(pt.x)}, ${Math.round(pt.y)})`).toBe(true);
          }
        }
      }
    }
  });
});

describe('the poses (pure): both portraits, at every moment', () => {
  it('both portraits stay on screen for the whole of every tier in every layout (the striker leaves only through the TOP, in III)', () => {
    for (const [name, a, d] of LAYOUTS) {
      for (const total of TOTALS) {
        const x = ctxOf(total, a, d);
        for (let t = x.p.chargeAt; t < x.p.endAt; t += 8) {
          const sp = at(a, strikerPose(x, t)), vp = at(d, victimPose(x, t));
          expect(onScreen(vp, FRAME, R * 0.3), `${name} ${total} victim at ${t}`).toBe(true);
          if (x.p.kind === 'elbow' && t >= x.p.downAt! && t < x.p.impactAt) {
            // the climb and the dive: on screen sideways, never below the floor
            expect(sp.x, `${name} striker x at ${t}`).toBeGreaterThan(R * 0.3);
            expect(sp.x).toBeLessThan(1920 - R * 0.3);
            expect(sp.y).toBeLessThan(1080 - R * 0.3);
          } else expect(onScreen(sp, FRAME, R * 0.3), `${name} ${total} striker at ${t} (${Math.round(sp.x)}, ${Math.round(sp.y)})`).toBe(true);
        }
      }
    }
  });

  it('both portraits are exactly at rest before the charge and from the end; they move without a jump (no teleport on screen)', () => {
    for (const total of TOTALS) {
      const x = ctxOf(total);
      for (const pose of [strikerPose, victimPose]) {
        expect(pose(x, x.p.chargeAt - 1)).toEqual({ x: 0, y: 0, rot: 0, scale: 1, squash: 0 });
        expect(pose(x, x.p.endAt)).toEqual({ x: 0, y: 0, rot: 0, scale: 1, squash: 0 });
        const last = pose(x, x.p.endAt - 1);
        expect(Math.hypot(last.x, last.y)).toBeLessThan(1);
        expect(Math.abs(last.rot)).toBeLessThan(0.5);
        let prev = pose(x, x.p.chargeAt);
        for (let t = x.p.chargeAt + 4; t < x.p.endAt; t += 4) {
          const q = pose(x, t);
          // off screen (III's held beat) it may be carried across; on screen never more than a fast move per 4 ms
          const hidden = x.p.kind === 'elbow' && pose === strikerPose && t >= x.p.perchAt! - 8 && t <= x.p.diveAt! + 8;
          if (!hidden) expect(Math.hypot(q.x - prev.x, q.y - prev.y), `${total} at ${t}`).toBeLessThan(R * 0.6);
          prev = q;
        }
      }
    }
  });

  it('I: the striker walks to the grab spot, LEANS AWAY on the wind-up, comes through; the struck portrait only staggers after the impact', () => {
    const x = ctxOf(3);
    const { p, g } = x;
    expect(dist(at(A, strikerPose(x, p.gripAt)), g.grab)).toBeLessThan(2);
    const wound = strikerPose(x, p.chopAt! - 1);
    expect(wound.rot * g.s).toBeCloseTo(C.chopLean, 0); // leaning away from the one it is about to chop
    expect(strikerPose(x, p.impactAt - 1).rot * g.s).toBeLessThan(0); // and through
    expect(Math.hypot(victimPose(x, p.impactAt - 1).x, victimPose(x, p.impactAt - 1).y)).toBeLessThan(1);
    const hit = victimPose(x, p.impactAt + 200);
    expect(hit.x * -g.s).toBeGreaterThan(R * 0.2); // a step away from the striker
    expect(Math.abs(hit.y)).toBeLessThan(R * 0.2);
  });

  it('II: the striker dips (squashed, lower), the struck portrait rises ABOVE it tilted flat and is held, then is on the mat at the impact and bounces once', () => {
    const x = ctxOf(8);
    const { p, g } = x;
    const dip = strikerPose(x, p.liftAt! - 1);
    expect(dip.squash).toBeGreaterThan(0.15);
    expect(at(A, dip).y).toBeGreaterThan(g.grab.y);
    const held = victimPose(x, (p.topAt! + p.slamAt!) / 2);
    const lifter = strikerPose(x, (p.topAt! + p.slamAt!) / 2);
    expect(at(D, held).y).toBeLessThan(at(A, lifter).y - R * 1.3);
    expect(Math.abs(at(D, held).x - at(A, lifter).x)).toBeLessThan(R * 0.4);
    expect(Math.abs(held.rot)).toBeGreaterThan(80);
    // the held beat really is held
    expect(dist(at(D, victimPose(x, p.topAt! + 10)), at(D, victimPose(x, p.slamAt! - 10)))).toBeLessThan(R * 0.1);
    expect(dist(at(D, victimPose(x, p.impactAt - 0.5)), g.mat)).toBeLessThan(R * 0.1);
    const mid = victimPose(x, p.impactAt + C.bounceMs / 2);
    expect(at(D, mid).y).toBeLessThan(g.mat.y - R * 0.2); // the bounce
    expect(victimPose(x, p.impactAt + 10).squash).toBeGreaterThan(0.15); // flattened against the mat
    expect(dist(at(D, victimPose(x, p.bounceEnd! + 20)), g.mat)).toBeLessThan(R * 0.1);
  });

  it('III: shoved flat (on its back, low), the striker leaves through the top, hangs there, and comes down FLAT onto it', () => {
    const x = ctxOf(14);
    const { p, g } = x;
    const flat = victimPose(x, p.downAt! + 40);
    expect(Math.abs(flat.rot)).toBeCloseTo(90, 0);
    expect(at(D, flat).y).toBeGreaterThanOrEqual(D.y);
    expect(at(A, strikerPose(x, p.perchAt! - 1)).y).toBeLessThan(-R); // out of the top
    for (let t = p.perchAt!; t < p.diveAt!; t += 20) expect(at(A, strikerPose(x, t)).y).toBeLessThan(-R);
    const a1 = at(A, strikerPose(x, p.diveAt! + C.diveMs * 0.4)), a2 = at(A, strikerPose(x, p.diveAt! + C.diveMs * 0.8));
    expect(a2.y).toBeGreaterThan(a1.y);
    expect(a2.y - a1.y).toBeGreaterThan(a1.y - g.sky.y); // accelerating
    expect(a1.x).toBe(g.mat.x); // straight down
    expect(Math.abs(strikerPose(x, p.impactAt - 1).rot)).toBeGreaterThan(80); // a flat dive
    expect(dist(at(A, strikerPose(x, p.impactAt - 0.5)), g.cover)).toBeLessThan(R * 0.1);
    expect(victimPose(x, p.impactAt + 10).squash).toBeGreaterThan(0.2);
  });

  it('IV: whipped to the far ropes, out with them and back, met in the middle, a flip, flat on the mat; the striker covers, presses on each count, and jumps up on the bell', () => {
    const x = ctxOf(40);
    const { p, g } = x;
    expect(dist(at(D, victimPose(x, p.ropeAt! - 0.5)), g.ropeHit)).toBeLessThan(R * 0.15);
    expect(dist(at(D, victimPose(x, (p.ropeAt! + p.flingAt!) / 2)), g.ropeMax)).toBeLessThan(R * 0.05);
    expect(victimPose(x, (p.ropeAt! + p.flingAt!) / 2).squash).toBeLessThan(-0.1); // narrowed against the ropes
    expect(dist(at(D, victimPose(x, p.impactAt - 0.5)), g.meet)).toBeLessThan(R * 0.1);
    // the two actually meet: overlapping at the clothesline
    expect(dist(at(D, victimPose(x, p.impactAt)), at(A, strikerPose(x, p.impactAt)))).toBeLessThan(R * 1.4);
    const air = victimPose(x, (p.impactAt + p.landAt!) / 2);
    expect(at(D, air).y).toBeLessThan(g.meet.y - R * 0.5); // up in the air
    expect(Math.abs(air.rot)).toBeGreaterThan(120); // turning over
    const down = victimPose(x, p.landAt! + 250);
    expect(dist(at(D, down), g.mat)).toBeLessThan(R * 0.1);
    expect(Math.abs(down.rot)).toBe(90);
    const pinned = strikerPose(x, p.pinAt! + 60);
    expect(dist(at(A, pinned), g.cover)).toBeLessThan(R * 0.2);
    expect(at(A, pinned).y).toBeLessThan(g.mat.y); // on top
    expect(at(A, strikerPose(x, p.counts[1]! + 60)).y).toBeGreaterThan(at(A, strikerPose(x, p.counts[1]! - 60)).y); // the press
    const up = strikerPose(x, p.bellAt! + 300);
    expect(up.scale).toBeGreaterThan(1.1);
    expect(dist(at(A, up), g.win)).toBeLessThan(R * 0.4);
  });

  it('a pose is a pure function of the time (a replay is identical)', () => {
    for (const total of TOTALS) {
      const x = ctxOf(total), y = ctxOf(total);
      for (let t = x.p.chargeAt; t < x.p.endAt; t += 37) {
        expect(strikerPose(x, t)).toEqual(strikerPose(y, t));
        expect(victimPose(x, t)).toEqual(victimPose(y, t));
      }
    }
  });
});

describe('the ring, the spotlight, the elbow star and the shadow (pure)', () => {
  it('IV only: the ropes stand up as the striker walks in, the FAR ropes stretch out with the struck portrait, snap back, and the ring is gone by the end', () => {
    for (const total of [3, 8, 14]) { const x = ctxOf(total); for (let t = 0; t < x.p.endAt; t += 40) expect(wrestleRing(x, t).visible).toBe(false); }
    const x = ctxOf(40);
    const { p, g } = x;
    expect(wrestleRing(x, p.walkAt - 1).visible).toBe(false);
    expect(wrestleRing(x, p.gripAt)).toMatchObject({ visible: true, far: 0, near: 0 });
    expect(wrestleRing(x, p.gripAt).rise).toBeCloseTo(1, 1);
    const mid = wrestleRing(x, (p.ropeAt! + p.flingAt!) / 2);
    expect(mid.far).toBeCloseTo(Math.abs(g.ropeMax.x - g.ropeHit.x), 3);
    expect(mid.near).toBe(0);
    expect(wrestleRing(x, p.flingAt! + 40).far).toBeLessThan(0); // the snap back past rest
    expect(Math.abs(wrestleRing(x, p.pinAt!).far)).toBeLessThan(R * 0.1);
    expect(wrestleRing(x, p.homeAt + 300).visible).toBe(false);
    expect(wrestleRing(x, p.endAt).visible).toBe(false);
  });

  it('III only: the spotlight comes on as the striker leaves, hunts and settles on the one on the mat; the elbow star leads the dive; a shadow grows', () => {
    for (const total of [3, 8, 40]) { const x = ctxOf(total); for (let t = 0; t < x.p.endAt; t += 40) { expect(wrestleSpot(x, t).visible).toBe(false); expect(wrestleElbow(x, t).visible).toBe(false); } }
    const x = ctxOf(14);
    const { p, g } = x;
    expect(wrestleSpot(x, p.downAt!).visible).toBe(false);
    const first = wrestleSpot(x, p.perchAt! + 40), found = wrestleSpot(x, p.diveAt!);
    expect(first.visible).toBe(true);
    expect(Math.abs(first.toX - g.mat.x)).toBeGreaterThan(R);
    expect(found).toMatchObject({ visible: true, toX: g.mat.x, toY: g.mat.y, fromY: 0 });
    expect(wrestleSpot(x, p.impactAt + 200).visible).toBe(false);
    expect(wrestleElbow(x, p.diveAt! - 1).visible).toBe(false);
    const star = wrestleElbow(x, p.diveAt! + 100), body = at(A, strikerPose(x, p.diveAt! + 100));
    expect(star.visible).toBe(true);
    expect(star.y).toBeGreaterThan(body.y); // it leads
    expect(wrestleElbow(x, p.impactAt).visible).toBe(false);
    expect(wrestleShadow(x, p.impactAt - 5).k).toBeGreaterThan(wrestleShadow(x, p.diveAt!).k);
    expect(wrestleShadow(x, p.impactAt + 1).k).toBe(0);
    const s = ctxOf(8);
    expect(wrestleShadow(s, s.p.slamAt!).k).toBeGreaterThan(0);
    expect(wrestleShadow(s, s.p.impactAt).k).toBe(0);
  });

  it('the camera pushes in while they are locked up and shakes on the impact (down for the slam, sideways for the chop); the count jolts it', () => {
    const slam = plan(8);
    expect(wrestleCameraAt(slam, C, slam.gripAt - 1, { x: 0, y: 1 }).zoom).toBe(1);
    expect(wrestleCameraAt(slam, C, slam.impactAt - 1, { x: 0, y: 1 }).zoom).toBeCloseTo(1 + slam.zoom, 3);
    const hit = wrestleCameraAt(slam, C, slam.impactAt + 12, { x: 0, y: 1 });
    expect(hit.y).toBeGreaterThan(1);
    const chop = wrestleCameraAt(plan(3), C, plan(3).impactAt + 12, { x: -1, y: 0 });
    expect(chop.x).toBeLessThan(0);
    expect(chop.y).toBe(0);
    const pin = plan(40);
    const j = wrestleCameraAt(pin, C, pin.counts[1]! + 10, { x: 1, y: 0 });
    expect(Math.abs(j.y)).toBeGreaterThan(0.5);
    for (let t = 0; t < pin.endAt; t += 16) { const m = wrestleCameraAt(pin, C, t, { x: 1, y: 0 }); expect(Math.hypot(m.x, m.y)).toBeLessThan(45); }
    expect(wrestleCameraAt(pin, C, pin.endAt, { x: 1, y: 0 }).zoom).toBeCloseTo(1, 2);
  });
});

function manualFrames() {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn: (dt: number) => void) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms: number, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

/** Tick frames until the attack's own clock reaches `t`. */
function tickTo(r: { h: { elapsed(): number; done: boolean }; f: { tick: (ms: number, step?: number) => void } }, t: number, step = 4): void {
  for (let i = 0; i < 20000 && !r.h.done && r.h.elapsed() < t; i++) r.f.tick(step, step);
}

function run(over: Partial<HeroWrestleOptions> = {}) {
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
  defenderEl.style.opacity = '0.9';
  camera.append(attackerEl, defenderEl);
  document.body.append(host, camera);
  const h = playHeroWrestle({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: A, defender: D, defenderRadius: R, attackerRadius: R,
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
  expect(r.defenderEl.style.opacity).toBe('0.9');
  expect(r.attackerEl.style.filter).toBe('');
  expect(r.defenderEl.style.filter).toBe('');
  expect(r.camera.style.transform).toBe('');
  expect(document.body.classList.contains(zClass)).toBe(false);
  expect(r.host.querySelector('.hblast')).toBeNull();
  expect(r.h.scene?.ownVisible ?? false).toBe(false);
}

describe('the runner (the shared clock, both portraits restored on every exit)', () => {
  afterEach(() => { document.body.innerHTML = ''; document.body.className = ''; });

  it('IV: the ropes, the landing, the count and the bell never land it; the blow lands ONCE on the clothesline; both portraits moved, raised, put back EXACTLY', () => {
    const r = run({ total: 40, formation: formationOf([40], 40) });
    const { h, onImpact, onDone } = r;
    expect(r.host.querySelector('.hblast.hwrestle')).not.toBeNull();
    tickTo(r, h.plan.gripAt + 20);
    expect(r.attackerEl.style.transform).toContain('translate('); // it walked over
    expect(document.body.classList.contains('duel-attacker-player')).toBe(true);
    expect(h.scene!.ownVisible).toBe(true); // the ring is up
    tickTo(r, h.plan.flingAt! + 20);
    expect(onImpact).not.toHaveBeenCalled(); // the ropes are a tick
    expect(r.defenderEl.style.transform).toContain('rotate(');
    tickTo(r, h.plan.impactAt - 12);
    expect(onImpact).not.toHaveBeenCalled();
    tickTo(r, h.plan.impactAt + 12);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(r.host.querySelector('.hblast-hit')!.textContent).toBe('-40');
    tickTo(r, h.plan.bellAt! + 40);
    expect(onImpact).toHaveBeenCalledTimes(1); // the landing, the cover, 1 2 3 and the bell are ticks
    expect(r.defenderEl.style.transform).toMatch(/rotate\(-?90\.00deg\)/); // flat on its back
    tickTo(r, h.plan.endAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
    r.f.tick(4000, 16);
    expect(r.f.hooked()).toBe(0);
    expect(r.root.children).toHaveLength(0);
  });

  it('the squash is written in SCREEN axes (outside the rotation), so a portrait on its back flattens against the mat', () => {
    const r = run({ total: 8, formation: formationOf([8], 8) });
    tickTo(r, r.h.plan.impactAt + 16);
    const css = r.defenderEl.style.transform;
    expect(css).toMatch(/translate\([^)]*\) scale\(1\.\d+, 0\.\d+\) rotate\(90\.00deg\) scale\(/);
    r.h.cancel();
  });

  it('cancel() mid-dive, finish() mid-lift and the safety timer each put both portraits back exactly (cancel never lands)', () => {
    const a = run({ total: 14, formation: formationOf([14], 14) });
    tickTo(a, a.h.plan.diveAt! + 60);
    expect(a.h.scene!.ownVisible).toBe(true); // the spotlight, the star, the shadow
    a.h.cancel();
    expect(a.onImpact).not.toHaveBeenCalled();
    expectRestored(a);
    expect(a.f.hooked()).toBe(0);
    document.body.innerHTML = '';

    const b = run({ total: 8, formation: formationOf([8], 8), side: 'opp', attacker: D, defender: A });
    tickTo(b, b.h.plan.topAt! + 40);
    expect(b.defenderEl.style.transform).not.toBe('translateY(2px)');
    expect(document.body.classList.contains('duel-attacker-opp')).toBe(true);
    b.h.finish();
    expect(b.onImpact).toHaveBeenCalledTimes(1);
    expectRestored(b, 'duel-attacker-opp');
    document.body.innerHTML = '';

    vi.useFakeTimers();
    try {
      const c = run({ total: 40, formation: formationOf([40], 40), safety: true });
      tickTo(c, c.h.plan.ropeAt! + 20);
      vi.advanceTimersByTime(c.h.plan.endAt + 3000);
      expect(c.onImpact).toHaveBeenCalledTimes(1);
      expect(c.h.done).toBe(true);
      expectRestored(c);
    } finally { vi.useRealTimers(); }
  });

  it('an unmount at any moment (Recruit cancels the handle) leaves no transform, no class and nothing drawn, at every tier', () => {
    for (const total of TOTALS) {
      for (const frac of [0.15, 0.35, 0.55, 0.75, 0.95]) {
        const r = run({ total, formation: formationOf([total], total) });
        tickTo(r, r.h.plan.chargeAt + (r.h.plan.endAt - r.h.plan.chargeAt) * frac, 8);
        r.h.cancel();
        expectRestored(r);
        expect(r.f.hooked()).toBe(0);
        expect(r.root.children, `${total} ${frac}`).toHaveLength(0);
        document.body.innerHTML = '';
      }
    }
  });

  it('both directions at every tier, within the cap, the blow once; the clock never changes speed; the camera applied once; a replay is identical; reduced motion', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of TOTALS) {
        const a = side === 'player' ? { x: 700, y: 900 } : { x: 1830, y: 90 };
        const d = side === 'player' ? { x: 1830, y: 90 } : { x: 700, y: 900 };
        const r = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        let played = 0;
        for (let i = 0; i < 3000 && !r.h.done; i++) {
          const before = r.h.elapsed();
          r.f.tick(16, 16); played += 16;
          if (!r.h.done) expect(r.h.elapsed() - before).toBe(16);
          peak = Math.max(peak, r.h.scene!.liveSprites);
        }
        expect(played).toBeLessThanOrEqual(r.h.plan.endAt + 32);
        expect(r.onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak, `${side} ${total}`).toBeLessThanOrEqual(MAX_WRESTLE_SPRITES);
        expect(peak, `${side} ${total}: well under the cap`).toBeLessThan(MAX_WRESTLE_SPRITES * 0.8);
        expectRestored(r, side === 'opp' ? 'duel-attacker-opp' : 'duel-attacker-player');
        r.h.cancel();
        document.body.innerHTML = '';
      }
    }
    const camera = document.createElement('div');
    camera.appendChild(document.createElement('canvas'));
    const c = run({ camera, total: 40, formation: formationOf([40], 40) });
    tickTo(c, c.h.plan.impactAt + 20);
    expect(c.h.mirrorsCamera).toBe(false);
    expect((c.root.children[0] as Container).scale.x).toBe(1);
    c.h.cancel();
    const x = run({ total: 40, formation: formationOf([40], 40), rollSeed: 5 });
    const y = run({ total: 40, formation: formationOf([40], 40), rollSeed: 5 });
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.geo).toEqual(y.h.geo);
    tickTo(x, x.h.plan.landAt! + 30); tickTo(y, y.h.plan.landAt! + 30);
    expect(x.attackerEl.style.transform).toBe(y.attackerEl.style.transform);
    expect(x.defenderEl.style.transform).toBe(y.defenderEl.style.transform);
    expect(x.h.scene!.liveSprites).toBe(y.h.scene!.liveSprites);
    x.h.cancel(); y.h.cancel();
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expect(r.attackerEl.style.transform).toBe('translateX(3px)');
    expect(r.defenderEl.style.transform).toBe('translateY(2px)');
  });

  it('a knockout for 2 plays the whole finisher (the ring, the count) and lands once on the clothesline', () => {
    const r = run({ total: 2, knockout: true, formation: formationOf([2], 2) });
    expect(r.h.plan.kind).toBe('pin');
    tickTo(r, r.h.plan.impactAt + 12);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    tickTo(r, r.h.plan.endAt + 32, 8);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
  });
});

describe('the scene (headless Pixi)', () => {
  it('pools, stays under the cap, hides its own objects, drains, and destroy leaves nothing', () => {
    const scene = new HeroWrestleScene(TEX, { mat: 0xe9dfc8, flash: 0xfff4dc, pow: 0xffd23f, hand: 0xef3b2e, spot: 0xfff1c4, side: 0xffcf5a },
      { ropeSize: 1, wordSize: 1, frameW: 1920, frameH: 1080 }, R, R, 1, 9);
    const g = wrestleGeo(A, D, R, R, FRAME, 'pin', C);
    scene.setRing(ringLayout(g, R, R), { visible: true, rise: 1, alpha: 1, near: 0, far: 40 });
    expect(scene.ownVisible).toBe(true);
    scene.setRing(ringLayout(g, R, R), { visible: false, rise: 0, alpha: 0, near: 0, far: 0 });
    expect(scene.ownVisible).toBe(false);
    scene.setSpot({ visible: true, fromX: 100, fromY: 0, toX: 200, toY: 500, alpha: 1 });
    scene.setElbow({ visible: true, x: 10, y: 10, rot: 0, scale: 1 });
    scene.setShadow(D, 0.5);
    expect(scene.ownVisible).toBe(true);
    for (let i = 0; i < 4; i++) {
      scene.step(A, R, -1); scene.slapArc(D, -1, R); scene.chop(D, -1, 2, 8); scene.matRing(D, R, 2, 8); scene.wallop(D, R, 2); scene.ropeTwang(D, 1);
      scene.rush(D, 1, R); scene.count(D, i); scene.matSlap(D, R); scene.bell(D, R); scene.winner(A, R, 2); scene.dizzy(D, R); scene.word('woo', D, 1); scene.word('slam', D, 1);
    }
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_WRESTLE_SPRITES);
    scene.hideOwn();
    expect(scene.ownVisible).toBe(false);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    expect(scene.liveSprites).toBe(0);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });

  it('the far ropes drawn stretched: each rope is two lengths meeting at a bend pushed OUT of the ring, and thinner than at rest', () => {
    const scene = new HeroWrestleScene(TEX, { mat: 0, flash: 0, pow: 0, hand: 0, spot: 0, side: 0 }, { ropeSize: 1, wordSize: 1 }, R, R, 1, 9);
    const g = wrestleGeo(A, D, R, R, FRAME, 'pin', C);
    const sides = ringLayout(g, R, R);
    const ropes = (): { x: number; y: number; len: number; rot: number; thick: number }[] => scene.root.children.flatMap((layer) => (layer as Container).children)
      .filter((s) => (s as { anchor?: { x: number } }).anchor?.x === 0 && s.visible).map((s) => ({ x: s.x, y: s.y, len: s.scale.x * 128, rot: s.rotation, thick: s.scale.y }));
    scene.setRing(sides, { visible: true, rise: 1, alpha: 1, near: 0, far: 0 });
    const rest = ropes();
    expect(rest).toHaveLength(12);
    scene.setRing(sides, { visible: true, rise: 1, alpha: 1, near: 0, far: 60 });
    const pushed = ropes();
    // the near side is untouched; the far side's second lengths start further OUT
    for (let i = 0; i < 6; i++) expect(pushed[i]).toEqual(rest[i]);
    for (let i = 6; i < 12; i += 2) {
      expect((pushed[i + 1]!.x - rest[i + 1]!.x) * sides[1].out).toBeGreaterThan(40);
      expect(pushed[i]!.len).toBeGreaterThan(rest[i]!.len);
      expect(pushed[i]!.thick).toBeLessThan(rest[i]!.thick);
    }
    scene.destroy();
  });
});
