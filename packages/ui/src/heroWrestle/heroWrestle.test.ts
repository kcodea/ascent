// @vitest-environment jsdom
/**
 * THE WRESTLING HERO ATTACK ("Top Rope", attack_wrestle, a Legendary): the shared tiers onto the four moves
 * and their two variants each (rolled from the stable seed, each one forceable); the tuner values and the sounds; the
 * pure plan (the blow lands ONCE: the chop, the chair, the slam, the suplex, the elbow, the splash, the clothesline, the
 * cutter; the shove, the climb, the ropes, the landings, the count and the bell are ticks); the geometry (every spot on
 * screen, in both directions and from the corners; the one exception is the cutter's run off the screen); the pure poses
 * of BOTH portraits; the ring of light, the turnbuckle, the chair, the dizzy stars, the spotlight, the elbow star and
 * the shadow; the camera (zooms, pans and shakes that never show an edge of the board, back to rest at the end); the
 * runner (both portraits' transforms, the striker's opacity, the z-order, the camera and the backdrop's socket shades
 * restored exactly on the end, finish, cancel and the safety timer; everything hidden; the clock never changes speed);
 * the scene.
 *
 * THE THIRD PASS (owner 2026-11-13: "a comedy attack ... go further in every tier to make it funnier and more
 * aggressive. add some camera zooms and pans and shakes and more funny wrestling stuff"): two variants a tier, the
 * camera framing, the turnbuckle taunt, the chair, the airplane spin, the suplex, the splash and the jumping cutter with
 * its voice line.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES } from '../heroBlast/heroAttackStyle';
import {
  HERO_WRESTLE_CLIP_KEYS, HERO_WRESTLE_DEFAULTS, HERO_WRESTLE_RANGES, RING_BACK, RING_FRONT, clampHeroWrestleValue, heroWrestleConfigJson, onScreen, ringLayout,
  ropeStretch, strikerPose, variantOf, victimPose, wrestleCameraAt, wrestleChair, wrestleCues, wrestleDizzy, wrestleElbow, wrestleFrameTransform, wrestleGeo,
  wrestleKind, wrestlePlan, wrestlePost, wrestleRing, wrestleShadow, wrestleShots, wrestleSpot, wrestleView,
  type HeroWrestleNumKey, type WrestleCtx, type WrestleVariant,
} from './heroWrestleConfig';
import { HeroWrestleScene, MAX_WRESTLE_SPRITES, type HeroWrestleTextures } from './heroWrestleScene';
import { playHeroWrestle, poseCss, SocketShade, type HeroWrestleOptions } from './heroWrestle';
import { WRESTLE_COUNTS, WRESTLE_WORDS } from './heroWrestleTextures';
import { SPEC } from '../HeroWrestleTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroWrestleTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  tube: W, mat: W, cone: W, hand: W, arc: W, impact: W, puff: W, shadow: W, wordWoo: W, wordSlam: W, wordWinner: W, wordSplash: W, wordBonk: W,
  num1: W, num2: W, num3: W,
};
const C = HERO_WRESTLE_DEFAULTS;
type V = WrestleVariant;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean; variant?: V } = {}) => wrestlePlan({ total, leadIn: leadInOf([total], o.reduced), ...o }, C);
const A = { x: 300, y: 860 }, D = { x: 1620, y: 220 };
const R = 80;
const FRAME = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
const ctxOf = (total: number, a = A, d = D, frame = FRAME, o: { knockout?: boolean; variant?: V } = {}): WrestleCtx => {
  const p = plan(total, o);
  return { p, g: wrestleGeo(a, d, R, R, frame, p.kind, C, p.variant), c: C, a, d, aR: R, dR: R };
};
const TOTALS = [3, 8, 14, 40] as const; // Tier 1, 2, 3, 4
const VARIANTS: readonly V[] = [1, 2];
const cueKinds = (total: number, variant: V = 1) => wrestleCues(plan(total, { variant })).map((q) => q.kind);
const at = (slot: { x: number; y: number }, p: { x: number; y: number }) => ({ x: slot.x + p.x, y: slot.y + p.y });
const dist = (p: { x: number; y: number }, q: { x: number; y: number }): number => Math.hypot(p.x - q.x, p.y - q.y);

describe('the tiers: the shared four onto the four moves, two variants each', () => {
  it('uses the shared thresholds; Tier 1 the chop, Tier 2 the slam, Tier 3 the elbow, Tier 4 the finisher; a knockout plays the finisher', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).kind, `dmg ${d}`).toBe(wrestleKind(tierOf(d)));
    expect([1, 2, 3, 4].map((t) => wrestleKind(t as 1 | 2 | 3 | 4))).toEqual(['chop', 'slam', 'elbow', 'pin']);
    for (const variant of VARIANTS) {
      expect(plan(2, { knockout: true, variant })).toMatchObject({ tier: 4, kind: 'pin', variant });
      expect(wrestleCues(plan(2, { knockout: true, variant })).map((q) => q.kind)).toEqual(expect.arrayContaining(['impact', 'cover', 'count', 'bell']));
    }
  });

  it('the variant is rolled from the seed (stable, both come up) and the tuner can force each one', () => {
    const seen = new Set<number>();
    for (let s = 0; s < 80; s++) { expect(variantOf(s, C)).toBe(variantOf(s, C)); seen.add(variantOf(s, C)); }
    expect([...seen].sort()).toEqual([1, 2]);
    for (const v of ['1', '2']) for (let s = 0; s < 20; s++) expect(variantOf(s, { ...C, variation: v })).toBe(Number(v));
    expect(plan(8).variant).toBe(1);
    expect(plan(8, { variant: 2 }).variant).toBe(2);
  });

  it('is a style (in the style list and the dev override; the Top Rope cosmetic plays it)', () => {
    expect(HERO_ATTACK_STYLES).toContain('wrestle');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('wrestle');
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; buttons on top; a clip row per sound; tiers named Tier 1 to 4', () => {
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
    const variation = SPEC.controls.find((c) => c.key === 'variation')!;
    expect(variation.options).toEqual(['', '1', '2']);
    // Tier names: "Tier 1".."Tier 4", never roman numerals or Small / Big / Huge.
    const text = JSON.stringify(SPEC.controls.map((c) => [c.label, c.group, c.hint]));
    expect(text).not.toMatch(/\b(I|II|III|IV)\b|\bHuge\b|\bSmall\b/);
    expect(text).toMatch(/Tier 4/);
  });

  it('the sounds: its own clips (the third pass adds the voice, the chair, the big slam, the flashes); every default clip exists', async () => {
    expect(C.sfxChopClip).toBe('fx/wrestle-chop');
    expect(C.sfxSlamClip).toBe('fx/wrestle-slam');
    expect(C.sfxBellClip).toBe('fx/wrestle-bell');
    expect(C.sfxWooClip).toBe('fx/wrestle-woo');
    expect(C.sfxThudClip).toBe('fx/wrestle-thud');
    expect(C.sfxRopeClip).toBe('fx/wrestle-rope');
    expect(C.sfxSlapClip).toBe('fx/wrestle-slap');
    expect(C.sfxRoarClip).toBe('fx/wrestle-roar');
    expect(C.sfxOohClip).toBe('fx/soccer-crowd-ooh');
    expect(C.sfxVoiceClip).toBe('fx/wrestle-watchout');
    expect(C.sfxChairClip).toBe('fx/wrestle-chair');
    expect(C.sfxBigClip).toBe('fx/wrestle-bigslam');
    expect(C.sfxFlashClip).toBe('fx/wrestle-flashes');
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const k of HERO_WRESTLE_CLIP_KEYS) {
      const id = C[k];
      const base = resolve(__dirname, '../audio', id);
      expect(existsSync(`${base}.mp3`) || existsSync(`${base}.wav`), `${k} = ${id}`).toBe(true);
    }
  });

  it('the words on screen are short and plain (and never the cutter\'s trademark name)', () => {
    for (const w of [...WRESTLE_WORDS, ...WRESTLE_COUNTS]) {
      expect(w.length).toBeLessThanOrEqual(7);
      expect(w).not.toMatch(/—|--|oath|climb|rko/i);
    }
  });
});

describe('the plan (the striker walks in; the blow lands once)', () => {
  it('every tier and variant: the walk, the grip, then the move; exactly one impact cue; the charge first and the end last; in time order', () => {
    for (const total of TOTALS) {
      for (const variant of VARIANTS) {
        const p = plan(total, { variant });
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
    }
  });

  it('Tier 1: THE CHOP winds up then comes through = THE impact; THE CHAIR comes up, goes overhead, comes down; both shorter than Tier 2', () => {
    const p = plan(3);
    expect(p.chopAt! - p.gripAt).toBe(C.chopWindMs);
    expect(p.impactAt - p.chopAt!).toBe(C.chopMs);
    expect(cueKinds(3)).toEqual(['charge', 'walk', 'grip', 'swing', 'impact', 'home', 'end']);
    const q = plan(3, { variant: 2 });
    expect(q.chairAt! - q.gripAt).toBe(C.chairRiseMs);
    expect(q.chopAt! - q.chairAt!).toBe(C.chairWindMs);
    expect(cueKinds(3, 2)).toEqual(['charge', 'walk', 'grip', 'chair', 'swing', 'impact', 'home', 'end']);
    for (const v of VARIANTS) expect(plan(3, { variant: v }).endAt - p.chargeAt).toBeLessThan(plan(8).endAt - plan(8).chargeAt);
  });

  it('Tier 2: the dip, the lift, a LONG held beat (the airplane spin, or the suplex held upside down), the drop = THE impact, two bounces (ticks)', () => {
    for (const variant of VARIANTS) {
      const p = plan(8, { variant });
      expect(p.gripAt).toBeLessThan(p.liftAt!);
      expect(p.liftAt!).toBeLessThan(p.topAt!);
      expect(p.slamAt! - p.topAt!).toBe(C.hangMs);
      expect(p.impactAt).toBeGreaterThan(p.slamAt!);
      expect(p.bounceEnd!).toBeGreaterThan(p.impactAt);
      expect(p.homeAt).toBeGreaterThan(p.bounceEnd!);
      expect(p.jolts).toHaveLength(2);
      expect(cueKinds(8, variant)).toEqual(['charge', 'walk', 'grip', 'lift', 'top', 'drop', 'impact', 'bounce', 'home', 'end']);
    }
    expect(plan(8, { variant: 2 }).impactAt - plan(8, { variant: 2 }).slamAt!).toBeGreaterThan(plan(8).impactAt - plan(8).slamAt!); // the topple is longer
  });

  it('Tier 3: the shove flat, the climb (a jolt on each hop), the taunt, the leap = THE impact', () => {
    for (const variant of VARIANTS) {
      const p = plan(14, { variant });
      expect(p.downAt! - p.gripAt).toBe(C.shoveMs);
      expect(p.perchAt! - p.downAt!).toBe(C.climbMs);
      expect(p.diveAt! - p.perchAt!).toBe(C.perchMs);
      expect(p.impactAt - p.diveAt!).toBe(C.diveMs);
      expect(p.bounceEnd! - p.impactAt).toBe(C.bounceMs);
      expect(p.jolts.filter((j) => j.at > p.downAt! && j.at <= p.perchAt!)).toHaveLength(4);
      expect(cueKinds(14, variant)).toEqual(['charge', 'walk', 'grip', 'down', 'perch', 'dive', 'impact', 'bounce', 'home', 'end']);
    }
  });

  it('Tier 4, the clothesline: the whip, the ropes, flung back, the clothesline = THE impact; the landing, the cover, 1 2 3 and the bell are ticks', () => {
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
    expect(cueKinds(40)).toEqual(['charge', 'walk', 'grip', 'whip', 'rope', 'fling', 'impact', 'land', 'hop', 'cover', 'count', 'count', 'count', 'bell', 'home', 'end']);
    expect(p.coverAt! - p.landAt!).toBe(C.afterMs);
    expect(p.pinAt! - p.coverAt!).toBe(C.coverMs);
    expect(p.impactAt - p.chargeAt).toBeGreaterThan(1500);
    expect(p.endAt - p.chargeAt).toBeGreaterThan(5000);
    expect(p.endAt - p.chargeAt).toBeLessThan(6500);
  });

  it('Tier 4, the jumping cutter: the run off, the voice (its third shout on the leap), the leap in, the catch, the cut = THE impact; then the pin', () => {
    const p = plan(40, { variant: 2 });
    expect(p.whipAt).toBeNull();
    expect(p.exitAt! - p.gripAt).toBe(C.exitMs);
    expect(p.leapAt! - p.exitAt!).toBe(C.dazeMs);
    expect(p.leapAt! - p.voiceAt!).toBe(C.voiceLeadMs);
    expect(p.voiceAt!).toBeGreaterThan(p.exitAt!); // the striker is already gone when the yelling starts
    expect(p.catchAt! - p.leapAt!).toBe(C.leapMs);
    expect(p.impactAt - p.catchAt!).toBe(C.cutMs);
    expect(cueKinds(40, 2)).toEqual(['charge', 'walk', 'grip', 'exit', 'voice', 'leap', 'catch', 'impact', 'hop', 'cover', 'count', 'count', 'count', 'bell', 'home', 'end']);
    // A real build-up: the voice is heard for its whole 1.6 s line before the hit lands.
    expect(p.impactAt - p.voiceAt!).toBeGreaterThan(1600);
    expect(p.endAt - p.chargeAt).toBeGreaterThan(6000);
    expect(p.endAt - p.chargeAt).toBeLessThan(8000);
  });

  it('WEIGHT: the big moves are HELD, then FAST; the hit shakes hard (harder each tier); an aftermath follows', () => {
    const [slam, elbow, pin] = [plan(8), plan(14), plan(40)];
    expect(slam.slamAt! - slam.topAt!).toBeGreaterThanOrEqual(800);
    expect(slam.impactAt - slam.slamAt!).toBeLessThan((slam.slamAt! - slam.topAt!) / 3);
    expect(elbow.diveAt! - elbow.perchAt!).toBeGreaterThanOrEqual(700);
    expect(elbow.impactAt - elbow.diveAt!).toBeLessThan(elbow.diveAt! - elbow.perchAt!);
    expect(pin.flingAt! - pin.ropeAt!).toBeGreaterThanOrEqual(400);
    expect(pin.impactAt - pin.flingAt!).toBeLessThan((pin.flingAt! - pin.ropeAt!) / 2);
    expect(plan(3).shakePx).toBeGreaterThanOrEqual(8);
    expect(slam.shakePx).toBeGreaterThan(plan(3).shakePx);
    expect(elbow.shakePx).toBeGreaterThan(slam.shakePx);
    expect(pin.shakePx).toBeGreaterThan(elbow.shakePx);
    const peak = (p: typeof slam, dir: { x: number; y: number }): number => {
      let m = 0;
      for (let t = p.impactAt; t < p.impactAt + 300; t += 4) { const k = wrestleCameraAt(p, C, t, dir); m = Math.max(m, Math.hypot(k.x, k.y)); }
      return m;
    };
    expect(peak(elbow, { x: 0, y: 1 })).toBeGreaterThan(20);
    expect(peak(pin, { x: 1, y: 0 })).toBeGreaterThan(28);
    expect(slam.homeAt - slam.impactAt).toBeGreaterThanOrEqual(900);
    expect(elbow.homeAt - elbow.impactAt).toBeGreaterThanOrEqual(1000);
    const ks = pin.counts.map((t) => pin.jolts.find((j) => j.at === t)!.k);
    expect(ks[0]!).toBeGreaterThan(0.3);
    expect(ks[1]!).toBeGreaterThan(ks[0]!);
    expect(ks[2]!).toBeGreaterThan(ks[1]!);
    expect(pin.jolts.find((j) => j.at === pin.landAt)!.k).toBeGreaterThan(0.7);
  });

  it('no hit-stop and no slow motion: the plan carries no hold', () => {
    for (const total of TOTALS) for (const variant of VARIANTS) expect(Object.keys(plan(total, { variant })).join(' ')).not.toMatch(/hitStop|slow|freeze/i);
  });

  it('reduced motion: no pose, no ring, no light, no chair, no stars; the blow lands at the end of the formation', () => {
    const p = plan(40, { reduced: true });
    expect(p.reduced).toBe(true);
    expect(wrestleCues(p).map((q) => q.kind)).toEqual(['impact', 'end']);
    const x: WrestleCtx = { p, g: wrestleGeo(A, D, R, R, FRAME, p.kind, C), c: C, a: A, d: D, aR: R, dR: R };
    for (let t = 0; t < p.endAt; t += 50) {
      expect(strikerPose(x, t)).toMatchObject({ x: 0, y: 0, rot: 0, squash: 0, flip: 1 });
      expect(victimPose(x, t)).toMatchObject({ x: 0, y: 0, rot: 0, squash: 0, flip: 1 });
      expect(wrestleRing(x, t).visible).toBe(false);
      expect(wrestleSpot(x, t).visible).toBe(false);
      expect(wrestleElbow(x, t).visible).toBe(false);
      expect(wrestleDizzy(x, t).visible).toBe(false);
      expect(wrestleChair(x, t).visible).toBe(false);
    }
    expect(wrestleCameraAt(p, C, 1000, { x: 0, y: 1 })).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(wrestleShots(x)).toEqual([]);
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
    expect(wrestleGeo({ x: 1800, y: 900 }, { x: 1800, y: 200 }, R, R, FRAME, 'chop', C).s).toBe(-1);
  });

  it('Tier 2: held ABOVE the striker and slammed down beside it; Tier 3: the turnbuckle beside the mat, its top well above it', () => {
    const s = wrestleGeo(A, D, R, R, FRAME, 'slam', C);
    expect(s.top.y).toBeLessThan(s.stand.y - R * 1.2);
    expect(Math.abs(s.top.x - s.stand.x)).toBeLessThan(R * 0.5);
    expect(s.mat.y).toBeGreaterThan(s.top.y + R * 1.2);
    expect(Math.abs(s.mat.x - s.stand.x)).toBeGreaterThan(R);
    for (const [name, a, d] of LAYOUTS) {
      const e = wrestleGeo(a, d, R, R, FRAME, 'elbow', C);
      expect(e.perch.y, name).toBeLessThan(e.mat.y - R * 1.6);
      expect(Math.abs(e.perch.x - e.mat.x), name).toBeGreaterThan(R);
      expect(e.postFoot.y, name).toBeGreaterThan(e.mat.y);
      expect(e.cover.y, name).toBeLessThan(e.mat.y);
    }
  });

  it('Tier 4: the ring fits the screen; the struck slot is by the near ropes, the whip goes PAST the striker to the far ropes, which stretch OUT', () => {
    for (const [name, a, d] of LAYOUTS) {
      const g = wrestleGeo(a, d, R, R, FRAME, 'pin', C);
      const { ring } = g;
      expect(ring.half, name).toBeGreaterThan(R * 2);
      for (const x of [ring.xNear, ring.xFar]) { expect(x, name).toBeGreaterThan(0); expect(x, name).toBeLessThan(1920); }
      expect(Math.abs(d.x - ring.xNear), name).toBeLessThan(Math.abs(d.x - ring.xFar));
      expect((g.grab.x - d.x) * g.s, name).toBeGreaterThan(0);
      expect((ring.xFar - g.grab.x) * g.s, name).toBeGreaterThan(0);
      expect((g.ropeMax.x - g.ropeHit.x) * g.s, name).toBeCloseTo(R * C.stretch, 5);
      expect((g.meet.x - g.block.x) * g.s, name).toBeGreaterThan(0);
      const [near, far] = ringLayout(g, R, R);
      expect(near.out, name).toBe(-g.s);
      expect(far.out, name).toBe(g.s);
      for (const sd of [near, far]) {
        for (const pt of [sd.back, sd.front]) expect(onScreen(pt, FRAME, 0), `${name} corner`).toBe(true);
        expect(sd.back.y, name).toBeCloseTo(ring.cy - R * RING_BACK, 5);
        expect(sd.front.y, name).toBeCloseTo(ring.cy + R * RING_FRONT, 5);
        expect((sd.front.x - sd.back.x) * sd.out, name).toBeGreaterThan(0);
        expect(sd.back.y - sd.backH, name).toBeGreaterThan(0);
        expect(sd.back.y - sd.backH * 0.4, name).toBeLessThan(ring.cy - R);
        expect(sd.front.y - sd.frontH * 0.92, name).toBeGreaterThan(ring.cy + R * 0.9);
      }
      expect(Math.abs(far.front.x - near.front.x), name).toBeGreaterThan(R * 6);
      expect(near.front.y - near.back.y, name).toBeGreaterThan(R * 3.5);
      // The cutter: it reels into the ring; the striker runs off the screen on the far side and leaps back in from there.
      const v = wrestleGeo(a, d, R, R, FRAME, 'pin', C, 2);
      expect(onScreen(v.daze, FRAME, R), name).toBe(true);
      expect(onScreen(v.offscreen, FRAME, -R), name).toBe(false);
      expect(onScreen(v.entry, FRAME, -R), name).toBe(false);
      expect((v.offscreen.x - v.daze.x) * v.s, name).toBeGreaterThan(0);
    }
  });

  it('every layout, tier and variant, 1920 x 1080 and 1600 x 900: every spot a portrait is sent to is on screen (the cutter\'s run off is the one exception)', () => {
    for (const fr of [FRAME, { x0: 0, y0: 0, x1: 1600, y1: 900 }]) {
      const k = fr.x1 / 1920;
      for (const [name, a0, d0] of LAYOUTS) {
        const a = { x: a0.x * k, y: a0.y * k }, d = { x: d0.x * k, y: d0.y * k };
        for (const kind of ['chop', 'slam', 'elbow', 'pin'] as const) {
          for (const variant of VARIANTS) {
            const g = wrestleGeo(a, d, R, R, fr, kind, C, variant);
            for (const [label, pt] of Object.entries({ grab: g.grab, stagger: g.stagger, under: g.under, stand: g.stand, top: g.top, mat: g.mat, perch: g.perch, cover: g.cover, ropeHit: g.ropeHit, ropeMax: g.ropeMax, block: g.block, meet: g.meet, win: g.win, count: g.count, daze: g.daze })) {
              expect(onScreen(pt, fr, R * 0.4), `${name} ${kind} ${variant} ${label} (${Math.round(pt.x)}, ${Math.round(pt.y)})`).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe('the poses (pure): both portraits, at every moment', () => {
  it('both portraits stay on screen for the whole of every tier and variant in every layout (only the cutter runs off the screen)', () => {
    for (const [name, a, d] of LAYOUTS) {
      for (const total of TOTALS) {
        for (const variant of VARIANTS) {
          const x = ctxOf(total, a, d, FRAME, { variant });
          for (let t = x.p.chargeAt; t < x.p.endAt; t += 8) {
            const sp = at(a, strikerPose(x, t)), vp = at(d, victimPose(x, t));
            expect(onScreen(vp, FRAME, R * 0.3), `${name} ${total} v${variant} victim at ${t}`).toBe(true);
            const away = x.p.kind === 'pin' && variant === 2 && t >= x.p.gripAt + 200 && t < x.p.catchAt!;
            if (!away) expect(onScreen(sp, FRAME, R * 0.3), `${name} ${total} v${variant} striker at ${t} (${Math.round(sp.x)}, ${Math.round(sp.y)})`).toBe(true);
          }
        }
      }
    }
  });

  it('both portraits are exactly at rest before the charge and from the end; they move without a jump (no teleport on screen)', () => {
    for (const total of TOTALS) {
      for (const variant of VARIANTS) {
        const x = ctxOf(total, A, D, FRAME, { variant });
        for (const pose of [strikerPose, victimPose]) {
          expect(pose(x, x.p.chargeAt - 1)).toEqual({ x: 0, y: 0, rot: 0, scale: 1, squash: 0, flip: 1 });
          expect(pose(x, x.p.endAt)).toEqual({ x: 0, y: 0, rot: 0, scale: 1, squash: 0, flip: 1 });
          const last = pose(x, x.p.endAt - 1);
          expect(Math.hypot(last.x, last.y)).toBeLessThan(1);
          expect(Math.abs(last.rot)).toBeLessThan(0.5);
          expect(Math.abs(last.flip - 1)).toBeLessThan(0.01);
          let prev = pose(x, x.p.chargeAt);
          for (let t = x.p.chargeAt + 4; t < x.p.endAt; t += 4) {
            const q = pose(x, t);
            // The cutter zips off the screen (a cartoon dash), is carried round out there, and leaps back in from beyond
            // the edge as a blur (streaks cover it): fast on purpose.
            const hidden = x.p.kind === 'pin' && variant === 2 && pose === strikerPose && t >= x.p.gripAt + 200 && t <= x.p.catchAt! + 8;
            if (!hidden) expect(Math.hypot(q.x - prev.x, q.y - prev.y), `${total} v${variant} ${pose === strikerPose ? "striker" : "victim"} at ${t} (grip ${x.p.gripAt}, exit ${x.p.exitAt}, leap ${x.p.leapAt}, catch ${x.p.catchAt})`).toBeLessThan(R * 0.6);
            prev = q;
          }
        }
      }
    }
  });

  it('Tier 1, the chop: the striker LEANS WAY BACK on the wind-up and comes through; the struck one is knocked away SPINNING like a top', () => {
    const x = ctxOf(3);
    const { p, g } = x;
    expect(dist(at(A, strikerPose(x, p.gripAt)), g.grab)).toBeLessThan(2);
    const wound = strikerPose(x, p.chopAt! - 1);
    expect(Math.abs(wound.rot * g.s - C.chopLean)).toBeLessThan(5);
    expect(wound.squash).toBeLessThan(-0.1); // stretched tall
    expect(strikerPose(x, p.impactAt - 1).rot * g.s).toBeLessThan(0);
    expect(Math.hypot(victimPose(x, p.impactAt - 1).x, victimPose(x, p.impactAt - 1).y)).toBeLessThan(1);
    const hit = victimPose(x, p.impactAt + 200);
    expect(hit.x * -g.s).toBeGreaterThan(R * 0.2);
    let minFlip = 1;
    for (let t = p.impactAt; t < p.impactAt + 800; t += 4) minFlip = Math.min(minFlip, victimPose(x, t).flip);
    expect(minFlip).toBeLessThan(-0.95); // turned right round
    expect(victimPose(x, p.impactAt + 760).flip).toBeGreaterThan(0.95); // and facing out again
  });

  it('Tier 1, the chair: it comes up, goes overhead, comes down on the head (THE impact) and bursts; the struck one concertinas, then springs tall', () => {
    const x = ctxOf(3, A, D, FRAME, { variant: 2 });
    const { p } = x;
    expect(wrestleChair(x, p.gripAt - 1).visible).toBe(false);
    const up = wrestleChair(x, p.chopAt! - 1), body = at(A, strikerPose(x, p.chopAt! - 1));
    expect(up.visible).toBe(true);
    expect(up.y).toBeLessThan(body.y - R); // overhead
    const hit = wrestleChair(x, p.impactAt - 0.5);
    expect(dist(hit, { x: D.x, y: D.y - R * 0.85 })).toBeLessThan(R * 0.4); // on the head
    expect(hit.burst).toBe(0);
    expect(wrestleChair(x, p.impactAt + 200).burst).toBeGreaterThan(0.5);
    expect(wrestleChair(x, p.impactAt + 600).visible).toBe(false);
    expect(victimPose(x, p.impactAt + 20).squash).toBeGreaterThan(0.5); // flat
    let tall = 0;
    for (let t = p.impactAt; t < p.impactAt + 600; t += 4) tall = Math.min(tall, victimPose(x, t).squash);
    expect(tall).toBeLessThan(-0.15); // and springs up too tall
    // Its feet stay on the floor while it is squashed: it moves DOWN by about half the squash.
    expect(victimPose(x, p.impactAt + 20).y).toBeGreaterThan(R * 0.3);
  });

  it('Tier 2, the airplane spin: held overhead, flat, both turning round and round together; facing out again for the slam; two bounces', () => {
    const x = ctxOf(8);
    const { p, g } = x;
    const dip = strikerPose(x, p.liftAt! - 1);
    expect(dip.squash).toBeGreaterThan(0.15);
    expect(at(A, dip).y).toBeGreaterThan(g.grab.y);
    const held = victimPose(x, p.topAt! + 10), lifter = strikerPose(x, p.topAt! + 10);
    expect(at(D, held).y).toBeLessThan(at(A, lifter).y - R * 1.3);
    expect(Math.abs(held.rot)).toBeGreaterThan(80);
    let minS = 1, minV = 1;
    for (let t = p.topAt!; t < p.slamAt!; t += 4) { minS = Math.min(minS, strikerPose(x, t).flip); minV = Math.min(minV, victimPose(x, t).flip); }
    expect(minS).toBeLessThan(-0.95);
    expect(minV).toBeLessThan(-0.95);
    expect(strikerPose(x, p.slamAt! - 1).flip).toBeGreaterThan(0.99);
    expect(at(D, victimPose(x, p.slamAt! - 1)).y).toBeLessThan(at(D, victimPose(x, p.topAt! + 10)).y - R * 0.1); // heaved higher
    expect(dist(at(D, victimPose(x, p.impactAt - 0.5)), g.mat)).toBeLessThan(R * 0.1);
    expect(at(D, victimPose(x, p.impactAt + C.bounceMs / 2)).y).toBeLessThan(g.mat.y - R * 0.3); // the first bounce
    expect(at(D, victimPose(x, p.bounceEnd! + C.bounceMs * 0.3)).y).toBeLessThan(g.mat.y - R * 0.1); // and a second
    expect(victimPose(x, p.impactAt + 10).squash).toBeGreaterThan(0.4); // flattened HARD
    const flex = strikerPose(x, p.impactAt + 520 + 115);
    expect(at(A, flex).y).toBeLessThan(g.stand.y - R * 0.1);
    expect(dist(at(D, victimPose(x, p.homeAt - 1)), g.mat)).toBeLessThan(R * 0.1);
  });

  it('Tier 2, the suplex: held UPSIDE DOWN over the striker, then over the top onto the mat as the striker falls back', () => {
    const x = ctxOf(8, A, D, FRAME, { variant: 2 });
    const { p, g } = x;
    const held = victimPose(x, (p.topAt! + p.slamAt!) / 2), lifter = strikerPose(x, (p.topAt! + p.slamAt!) / 2);
    expect(Math.abs(Math.abs(held.rot) - 180)).toBeLessThan(10);
    expect(at(D, held).y).toBeLessThan(at(A, lifter).y - R * 1.3);
    expect(Math.abs(at(D, held).x - at(A, lifter).x)).toBeLessThan(R * 0.4);
    expect(dist(at(D, victimPose(x, p.impactAt - 0.5)), g.mat)).toBeLessThan(R * 0.15);
    const landed = victimPose(x, p.impactAt + 10);
    expect(Math.abs(Math.abs(landed.rot) - 90)).toBeLessThan(25); // on its back (near enough)
    expect(Math.abs(strikerPose(x, p.impactAt).rot)).toBeGreaterThan(80); // the striker on its back too
    expect(Math.abs(strikerPose(x, p.homeAt - 1).rot)).toBeLessThan(5); // up again before going home
  });

  it('Tier 3: shoved flat; a hop to the turnbuckle and three up it; a taunt up there; a leap with absurd air onto it', () => {
    for (const variant of VARIANTS) {
      const x = ctxOf(14, A, D, FRAME, { variant });
      const { p, g } = x;
      const flat = victimPose(x, p.downAt! + 40);
      expect(Math.abs(Math.abs(flat.rot) - 90)).toBeLessThan(3);
      expect(dist(at(A, strikerPose(x, p.perchAt!)), g.perch)).toBeLessThan(2);
      for (let t = p.perchAt!; t < p.diveAt!; t += 20) expect(dist(at(A, strikerPose(x, t)), g.perch)).toBeLessThan(R * 0.2);
      // It rocks about while it taunts.
      let rmin = 0, rmax = 0;
      for (let t = p.perchAt!; t < p.diveAt! - 240; t += 8) { const r = strikerPose(x, t).rot; rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
      expect(rmax - rmin).toBeGreaterThan(20);
      let apex = Infinity;
      for (let t = p.diveAt!; t < p.impactAt; t += 4) apex = Math.min(apex, at(A, strikerPose(x, t)).y);
      expect(apex).toBeLessThan(g.perch.y - R * 0.3); // up before it comes down
      expect(dist(at(A, strikerPose(x, p.impactAt - 0.5)), g.cover)).toBeLessThan(R * 0.15);
      expect(victimPose(x, p.impactAt + 10).squash).toBeGreaterThan(0.3);
    }
    const elbow = ctxOf(14);
    expect(Math.abs(strikerPose(elbow, elbow.p.impactAt - 1).rot)).toBeGreaterThan(80); // a flat dive, the elbow leading
    const splash = ctxOf(14, A, D, FRAME, { variant: 2 });
    expect(strikerPose(splash, splash.p.impactAt - 1).squash).toBeGreaterThan(0.3); // spread wide and flat
    expect(victimPose(splash, splash.p.impactAt + 10).squash).toBeGreaterThan(victimPose(elbow, elbow.p.impactAt + 10).squash);
  });

  it('Tier 4, the clothesline: to the far ropes, out with them and back, met in the middle, a flip, flat on the mat; the cover, the press, WINNER', () => {
    const x = ctxOf(40);
    const { p, g } = x;
    expect(dist(at(D, victimPose(x, p.ropeAt! - 0.5)), g.ropeHit)).toBeLessThan(R * 0.15);
    expect(dist(at(D, victimPose(x, (p.ropeAt! + p.flingAt!) / 2)), g.ropeMax)).toBeLessThan(R * 0.05);
    expect(victimPose(x, (p.ropeAt! + p.flingAt!) / 2).squash).toBeLessThan(-0.1);
    expect(dist(at(D, victimPose(x, p.impactAt - 0.5)), g.meet)).toBeLessThan(R * 0.1);
    expect(dist(at(D, victimPose(x, p.impactAt)), at(A, strikerPose(x, p.impactAt)))).toBeLessThan(R * 1.4);
    const air = victimPose(x, (p.impactAt + p.landAt!) / 2);
    expect(at(D, air).y).toBeLessThan(g.meet.y - R * 0.5);
    expect(Math.abs(air.rot)).toBeGreaterThan(120);
    const down = victimPose(x, p.landAt! + 250);
    expect(dist(at(D, down), g.mat)).toBeLessThan(R * 0.1);
    expect(Math.abs(down.rot)).toBe(90);
    const pinned = strikerPose(x, p.pinAt! + 60);
    expect(dist(at(A, pinned), g.cover)).toBeLessThan(R * 0.2);
    expect(at(A, strikerPose(x, p.counts[1]! + 60)).y).toBeGreaterThan(at(A, strikerPose(x, p.counts[1]! - 60)).y);
    const up = strikerPose(x, p.bellAt! + 300);
    expect(up.scale).toBeGreaterThan(1.1);
    expect(dist(at(A, up), g.win)).toBeLessThan(R * 0.4);
  });

  it('Tier 4, the jumping cutter: off the screen it goes; the other staggers about dazed, looking the wrong way; in it flies, and both hit the mat', () => {
    for (const [name, a, d] of LAYOUTS) {
      const x = ctxOf(40, a, d, FRAME, { variant: 2 });
      const { p, g } = x;
      for (let t = p.exitAt!; t < p.leapAt!; t += 20) expect(onScreen(at(a, strikerPose(x, t)), FRAME, -R * 0.9), `${name} gone at ${t}`).toBe(false);
      let minFlip = 1;
      for (let t = p.exitAt! + 200; t < p.leapAt!; t += 8) {
        const v = at(d, victimPose(x, t));
        expect(dist(v, g.daze), `${name} dazed at ${t}`).toBeLessThan(R * 0.6);
        minFlip = Math.min(minFlip, victimPose(x, t).flip);
      }
      expect(minFlip, name).toBeLessThan(-0.5); // turned round, looking the wrong way
      expect(victimPose(x, p.catchAt!).flip, name).toBeGreaterThan(0.9); // facing out as it is caught
      expect(dist(at(a, strikerPose(x, p.catchAt!)), at(d, victimPose(x, p.catchAt!))), name).toBeLessThan(R * 1.2); // they meet
      expect(dist(at(d, victimPose(x, p.impactAt + 1)), g.mat), name).toBeLessThan(R * 0.1);
      expect(Math.abs(victimPose(x, p.impactAt + 100).rot), name).toBe(90);
      expect(dist(at(a, strikerPose(x, p.pinAt! + 60)), g.cover), name).toBeLessThan(R * 0.2);
    }
  });

  it('a pose is a pure function of the time (a replay is identical); the CSS caps the squash and never collapses a turn to nothing', () => {
    for (const total of TOTALS) {
      for (const variant of VARIANTS) {
        const x = ctxOf(total, A, D, FRAME, { variant }), y = ctxOf(total, A, D, FRAME, { variant });
        for (let t = x.p.chargeAt; t < x.p.endAt; t += 37) {
          expect(strikerPose(x, t)).toEqual(strikerPose(y, t));
          expect(victimPose(x, t)).toEqual(victimPose(y, t));
        }
      }
    }
    expect(poseCss({ x: 0, y: 0 }, { x: 0, y: 0, rot: 0, scale: 1, squash: 0, flip: 1 }, 1, 1)).toBeNull();
    expect(poseCss({ x: 0, y: 0 }, { x: 0, y: 0, rot: 0, scale: 1, squash: 2, flip: 0 }, 1, 1)).toBe('translate(0.00px, 0.00px) scale(0.0859, 0.2800) rotate(0.00deg) scale(1.0000)');
  });
});

describe('the ring, the turnbuckle, the spotlight, the elbow star, the dizzy stars and the shadow (pure)', () => {
  it('Tier 4 only: the ropes stand up as the striker walks in, the FAR ropes stretch out with the struck portrait, snap back, and the ring is gone by the end', () => {
    for (const total of [3, 8, 14]) { const x = ctxOf(total); for (let t = 0; t < x.p.endAt; t += 40) expect(wrestleRing(x, t).visible).toBe(false); }
    const x = ctxOf(40);
    const { p, g } = x;
    expect(wrestleRing(x, p.walkAt - 1).visible).toBe(false);
    expect(wrestleRing(x, p.gripAt)).toMatchObject({ visible: true, far: 0, near: 0 });
    expect(wrestleRing(x, p.gripAt).rise).toBeCloseTo(1, 1);
    const full = Math.abs(g.ropeMax.x - g.ropeHit.x);
    const len = p.flingAt! - p.ropeAt!;
    for (const u of [0.36, 0.5, 0.7]) expect(Math.abs(wrestleRing(x, p.ropeAt! + len * u).far - full), `u ${u}`).toBeLessThan(full * 0.05);
    expect(wrestleRing(x, p.ropeAt! + len * 0.15).far).toBeGreaterThan(full * 0.5);
    expect(ropeStretch(0)).toBe(0);
    expect(ropeStretch(1)).toBeCloseTo(0, 5);
    const out = (at(D, victimPose(x, p.ropeAt! + len * 0.5)).x - g.ropeHit.x) * g.s;
    expect(out).toBeCloseTo(wrestleRing(x, p.ropeAt! + len * 0.5).far, 3);
    const mid = wrestleRing(x, (p.ropeAt! + p.flingAt!) / 2);
    expect(Math.abs(mid.near)).toBeLessThan(R * 0.02);
    expect(mid.drop).toBe(0);
    let sag = 0;
    for (let t = p.landAt!; t < p.landAt! + 200; t += 4) sag = Math.max(sag, Math.abs(wrestleRing(x, t).drop));
    expect(sag).toBeGreaterThan(R * 0.08);
    expect(wrestleRing(x, p.flingAt! + 40).far).toBeLessThan(0);
    expect(Math.abs(wrestleRing(x, p.pinAt!).far)).toBeLessThan(R * 0.1);
    expect(wrestleRing(x, p.homeAt + 300).visible).toBe(false);
    expect(wrestleRing(x, p.endAt).visible).toBe(false);
    // The cutter: the ring is up too; it shudders under the cut.
    const y = ctxOf(40, A, D, FRAME, { variant: 2 });
    expect(wrestleRing(y, y.p.gripAt).visible).toBe(true);
    let sag2 = 0;
    for (let t = y.p.impactAt; t < y.p.impactAt + 200; t += 4) sag2 = Math.max(sag2, Math.abs(wrestleRing(y, t).drop));
    expect(sag2).toBeGreaterThan(R * 0.08);
  });

  it('Tier 3 only: the turnbuckle rises as the climb starts; the spotlight finds the striker on it, then follows the leap down; the elbow star leads the elbow (not the splash); a shadow grows', () => {
    for (const total of [3, 8, 40]) {
      const x = ctxOf(total);
      for (let t = 0; t < x.p.endAt; t += 40) { expect(wrestleSpot(x, t).visible).toBe(false); expect(wrestleElbow(x, t).visible).toBe(false); expect(wrestlePost(x, t).visible).toBe(false); }
    }
    const x = ctxOf(14);
    const { p, g } = x;
    const post = wrestlePost(x, p.perchAt!);
    expect(post).toMatchObject({ visible: true, x: g.perch.x });
    expect(post.top).toBeLessThan(post.foot - R * 1.5);
    expect(post.top).toBeGreaterThan(g.perch.y); // under the striker's feet
    expect(wrestlePost(x, p.impactAt + 400).visible).toBe(false);
    expect(wrestleSpot(x, p.downAt!).visible).toBe(false);
    const onIt = wrestleSpot(x, p.perchAt! + 200);
    expect(onIt.visible).toBe(true);
    expect(Math.abs(onIt.toX - g.perch.x)).toBeLessThan(1);
    expect(wrestleSpot(x, p.impactAt - 1).toX).toBeCloseTo(g.mat.x, 0);
    expect(wrestleSpot(x, p.impactAt + 200).visible).toBe(false);
    const star = wrestleElbow(x, p.diveAt! + C.diveMs * 0.7), body = at(A, strikerPose(x, p.diveAt! + C.diveMs * 0.7));
    expect(star.visible).toBe(true);
    expect(star.y).toBeGreaterThan(body.y);
    expect(wrestleElbow(x, p.impactAt).visible).toBe(false);
    const sp = ctxOf(14, A, D, FRAME, { variant: 2 });
    for (let t = sp.p.diveAt!; t < sp.p.impactAt; t += 8) expect(wrestleElbow(sp, t).visible).toBe(false);
    expect(wrestleShadow(x, p.impactAt - 5).k).toBeGreaterThan(wrestleShadow(x, p.diveAt! + 50).k);
    expect(wrestleShadow(x, p.impactAt + 1).k).toBe(0);
    const s = ctxOf(8);
    expect(wrestleShadow(s, s.p.slamAt!).k).toBeGreaterThan(0);
    expect(wrestleShadow(s, s.p.impactAt).k).toBe(0);
  });

  it('the dizzy stars: over the struck one\'s head after every hit (the cutter: while it staggers too), gone before it goes home', () => {
    for (const total of TOTALS) {
      for (const variant of VARIANTS) {
        const x = ctxOf(total, A, D, FRAME, { variant });
        expect(wrestleDizzy(x, x.p.impactAt - 1).visible && !(total === 40 && variant === 2), `${total} ${variant} before`).toBe(false);
        const t = total === 40 ? x.p.pinAt! + 100 : x.p.impactAt + 500;
        const dz = wrestleDizzy(x, t);
        expect(dz.visible, `${total} ${variant}`).toBe(true);
        const v = at(D, victimPose(x, t));
        expect(dz.y).toBeLessThan(v.y);
        expect(Math.abs(dz.x - v.x)).toBeLessThan(1);
        expect(wrestleDizzy(x, x.p.homeAt + 1).visible).toBe(false);
      }
    }
    const cut = ctxOf(40, A, D, FRAME, { variant: 2 });
    expect(wrestleDizzy(cut, (cut.p.exitAt! + cut.p.leapAt!) / 2).visible).toBe(true);
  });
});

describe('the camera: zooms, pans and shakes, never an edge of the board, back to rest', () => {
  it('the shake: sideways for the chop, down for the slams; the count jolts it; bounded', () => {
    const slam = plan(8);
    const hit = wrestleCameraAt(slam, C, slam.impactAt + 12, { x: 0, y: 1 });
    expect(hit.y).toBeGreaterThan(1);
    expect(hit.zoom).toBeGreaterThan(1); // the punch
    const chop = wrestleCameraAt(plan(3), C, plan(3).impactAt + 12, { x: -1, y: 0 });
    expect(chop.x).toBeLessThan(0);
    expect(chop.y).toBe(0);
    const pin = plan(40);
    expect(Math.abs(wrestleCameraAt(pin, C, pin.counts[1]! + 10, { x: 1, y: 0 }).y)).toBeGreaterThan(0.5);
    for (let t = 0; t < pin.endAt; t += 16) { const m = wrestleCameraAt(pin, C, t, { x: 1, y: 0 }); expect(Math.hypot(m.x, m.y)).toBeLessThan(50); }
    expect(wrestleCameraAt(pin, C, pin.endAt, { x: 1, y: 0 }).zoom).toBeCloseTo(1, 2);
  });

  it('the framing: pushed in on the wind-up and the held beats; whip-pans after the cutter; at rest at the start and the end; the board edge never shows', () => {
    for (const total of TOTALS) {
      for (const variant of VARIANTS) {
        for (const [name, a, d] of LAYOUTS) {
          const x = ctxOf(total, a, d, FRAME, { variant });
          const shots = wrestleShots(x);
          expect(wrestleView(shots, x.p.chargeAt, d)).toMatchObject({ zoom: 1, pan: 0 });
          expect(wrestleView(shots, x.p.endAt, d).zoom).toBeCloseTo(1, 5);
          for (let t = x.p.chargeAt; t < x.p.endAt; t += 16) {
            const v = wrestleView(shots, t, d);
            const z = v.zoom * wrestleCameraAt(x.p, C, t, { x: 1, y: 0 }).zoom;
            const ft = wrestleFrameTransform(z, v.lx, v.ly, v.pan, FRAME, C.pan);
            // the zoomed board still covers the whole frame (before the shake)
            expect(ft.ax, `${name} ${total} v${variant} ${t}`).toBeLessThanOrEqual(0.001);
            expect(ft.ax + 1920 * z).toBeGreaterThanOrEqual(1920 - 0.001);
            expect(ft.ay).toBeLessThanOrEqual(0.001);
            expect(ft.ay + 1080 * z).toBeGreaterThanOrEqual(1080 - 0.001);
          }
          expect(wrestleFrameTransform(1, 500, 500, 1, FRAME, 1)).toEqual({ ax: 0, ay: 0 });
        }
      }
    }
    const chop = ctxOf(3);
    expect(wrestleView(wrestleShots(chop), chop.p.chopAt! - 1, D).zoom).toBeCloseTo(1 + chop.p.zoom, 2);
    const slam = ctxOf(8);
    expect(wrestleView(wrestleShots(slam), slam.p.slamAt! - 1, D).zoom).toBeCloseTo(1 + slam.p.zoom, 2);
    // The cutter: in close on the dazed one while the voice yells, then a WHIP-PAN toward the edge it flies in from.
    const cut = ctxOf(40, { x: 700, y: 860 }, { x: 1200, y: 400 }, FRAME, { variant: 2 });
    const cs = wrestleShots(cut);
    const close = wrestleView(cs, cut.p.leapAt! - 130, D);
    expect(close.zoom).toBeGreaterThan(1 + cut.p.zoom * 1.2);
    const whip = wrestleView(cs, cut.p.leapAt! + 40, D);
    expect((whip.lx - close.lx) * cut.g.s).toBeGreaterThan(R);
    // A pan really moves the view: with the look point off to one side, the board is moved toward the middle.
    const ft = wrestleFrameTransform(1.2, 400, 540, 1, FRAME, 1);
    expect(ft.ax).toBeGreaterThan(400 * (1 - 1.2)); // further right than a plain zoom about the point
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

/** The runner on a manual clock. Variant 1 unless `variant` (forced through the config, as the tuner does). */
function run(over: Partial<HeroWrestleOptions> & { variant?: V } = {}) {
  const { variant = 1, ...rest } = over;
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
    reduced: false, cfg: { ...C, variation: String(variant) }, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...rest,
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

  it('Tier 4, the clothesline: the ropes, the landing, the count and the bell never land it; the blow lands ONCE; both portraits moved and put back EXACTLY', () => {
    const r = run({ total: 40, formation: formationOf([40], 40) });
    const { h, onImpact, onDone } = r;
    expect(h.variant).toBe(1);
    expect(r.host.querySelector('.hblast.hwrestle')).not.toBeNull();
    tickTo(r, h.plan.gripAt + 20);
    expect(r.attackerEl.style.transform).toContain('translate(');
    expect(document.body.classList.contains('duel-attacker-player')).toBe(true);
    expect(h.scene!.ownVisible).toBe(true);
    expect(r.camera.style.transform).toContain('scale('); // the camera is pushed in
    tickTo(r, h.plan.flingAt! + 20);
    expect(onImpact).not.toHaveBeenCalled();
    expect(r.defenderEl.style.transform).toContain('rotate(');
    tickTo(r, h.plan.impactAt - 12);
    expect(onImpact).not.toHaveBeenCalled();
    tickTo(r, h.plan.impactAt + 12);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(r.host.querySelector('.hblast-hit')!.textContent).toBe('-40');
    tickTo(r, h.plan.bellAt! + 40);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(r.defenderEl.style.transform).toMatch(/rotate\(-?90\.00deg\)/);
    tickTo(r, h.plan.endAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
    r.f.tick(4000, 16);
    expect(r.f.hooked()).toBe(0);
    expect(r.root.children).toHaveLength(0);
  });

  it('Tier 4, the jumping cutter: the run off, the voice and the leap never land it; it lands ONCE on the cut; everything put back', () => {
    const r = run({ total: 40, formation: formationOf([40], 40), variant: 2 });
    const { h, onImpact } = r;
    expect(h.variant).toBe(2);
    expect(h.plan.exitAt).not.toBeNull();
    tickTo(r, h.plan.leapAt! + 40);
    expect(onImpact).not.toHaveBeenCalled();
    tickTo(r, h.plan.impactAt + 12);
    expect(onImpact).toHaveBeenCalledTimes(1);
    tickTo(r, h.plan.endAt + 32, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
  });

  it('the rolled variant comes from the rollSeed (the same seed, the same move); the tuner forces it', () => {
    const seen = new Set<number>();
    for (let s = 0; s < 12; s++) {
      const r = run({ total: 14, formation: formationOf([14], 14), rollSeed: s, cfg: C });
      expect(r.h.variant).toBe(variantOf(s, C));
      seen.add(r.h.variant);
      r.h.cancel();
      document.body.innerHTML = '';
    }
    expect(seen.size).toBe(2);
    for (const v of VARIANTS) { const r = run({ total: 14, formation: formationOf([14], 14), rollSeed: 3, variant: v }); expect(r.h.variant).toBe(v); r.h.cancel(); }
  });

  it('THE EMPTY SOCKET: the backdrop shade under a portrait is off while it is away and put back EXACTLY on the end, finish and cancel', () => {
    const shadeEl = (): HTMLElement => {
      const el = document.createElement('div');
      el.className = 'boardbg-shade';
      el.style.setProperty('--psh-a', '0.8');
      document.body.append(el);
      return el;
    };
    const read = (el: HTMLElement) => ['--psh-a', '--bd-shade-r', '--bd-oshade-r'].map((k) => el.style.getPropertyValue(k));
    let el = shadeEl();
    const a = run({ total: 8, formation: formationOf([8], 8) });
    tickTo(a, a.h.plan.walkAt + 20);
    expect(read(el)).toEqual(['0.8', '', '']);
    tickTo(a, a.h.plan.gripAt);
    expect(read(el)).toEqual(['0', '0px', '']);
    tickTo(a, a.h.plan.topAt!);
    expect(read(el)).toEqual(['0', '0px', '0px']);
    tickTo(a, a.h.plan.homeEnd - 20);
    expect(read(el)).toEqual(['0.8', '', '']);
    tickTo(a, a.h.plan.endAt + 32, 8);
    expect(read(el)).toEqual(['0.8', '', '']);
    document.body.innerHTML = '';
    for (const exit of ['cancel', 'finish'] as const) {
      el = shadeEl();
      const b = run({ total: 40, formation: formationOf([40], 40), side: 'opp', attacker: D, defender: A });
      tickTo(b, exit === 'cancel' ? b.h.plan.counts[1]! : b.h.plan.whipAt! + 60);
      expect(read(el)).toEqual(['0', '0px', '0px']);
      b.h[exit]();
      expect(read(el)).toEqual(['0.8', '', '']);
      document.body.innerHTML = '';
    }
    // Tier 1: the chop knocks the struck one spinning out of its socket; the chair leaves it where it stands.
    el = shadeEl();
    const c = run({ total: 3, formation: formationOf([3], 3) });
    tickTo(c, c.h.plan.impactAt + 100);
    expect(read(el)).toEqual(['0', '0px', '0px']);
    c.h.cancel();
    expect(read(el)).toEqual(['0.8', '', '']);
    document.body.innerHTML = '';
    el = shadeEl();
    const ch = run({ total: 3, formation: formationOf([3], 3), variant: 2 });
    tickTo(ch, ch.h.plan.impactAt + 100);
    expect(read(el)).toEqual(['0', '0px', '']);
    ch.h.cancel();
    expect(read(el)).toEqual(['0.8', '', '']);
    const lone = new SocketShade(document);
    lone.set('opp', true);
    expect(lone.hidden('opp')).toBe(true);
    lone.restore();
    expect(lone.hidden('opp')).toBe(false);
    expect(() => { const none = new SocketShade(null); none.set('player', true); none.restore(); }).not.toThrow();
  });

  it('the squash is written in SCREEN axes (outside the rotation), so a portrait on its back flattens against the mat', () => {
    const r = run({ total: 8, formation: formationOf([8], 8) });
    tickTo(r, r.h.plan.impactAt + 16);
    const css = r.defenderEl.style.transform;
    expect(css).toMatch(/translate\([^)]*\) scale\(1\.\d+, 0\.\d+\) rotate\(90\.00deg\) scale\(/);
    r.h.cancel();
  });

  it('cancel() mid-leap, finish() mid-lift and the safety timer each put both portraits back exactly (cancel never lands)', () => {
    const a = run({ total: 14, formation: formationOf([14], 14) });
    tickTo(a, a.h.plan.diveAt! + 60);
    expect(a.h.scene!.ownVisible).toBe(true);
    a.h.cancel();
    expect(a.onImpact).not.toHaveBeenCalled();
    expectRestored(a);
    expect(a.f.hooked()).toBe(0);
    document.body.innerHTML = '';

    const b = run({ total: 8, formation: formationOf([8], 8), side: 'opp', attacker: D, defender: A, variant: 2 });
    tickTo(b, b.h.plan.topAt! + 40);
    expect(b.defenderEl.style.transform).not.toBe('translateY(2px)');
    expect(document.body.classList.contains('duel-attacker-opp')).toBe(true);
    b.h.finish();
    expect(b.onImpact).toHaveBeenCalledTimes(1);
    expectRestored(b, 'duel-attacker-opp');
    document.body.innerHTML = '';

    vi.useFakeTimers();
    try {
      const c = run({ total: 40, formation: formationOf([40], 40), safety: true, variant: 2 });
      tickTo(c, c.h.plan.voiceAt! + 20);
      vi.advanceTimersByTime(c.h.plan.endAt + 3000);
      expect(c.onImpact).toHaveBeenCalledTimes(1);
      expect(c.h.done).toBe(true);
      expectRestored(c);
    } finally { vi.useRealTimers(); }
  });

  it('an unmount at any moment (Recruit cancels the handle) leaves no transform, no class, no camera and nothing drawn, at every tier and variant', () => {
    for (const total of TOTALS) {
      for (const variant of VARIANTS) {
        for (const frac of [0.15, 0.35, 0.55, 0.75, 0.95]) {
          const r = run({ total, formation: formationOf([total], total), variant });
          tickTo(r, r.h.plan.chargeAt + (r.h.plan.endAt - r.h.plan.chargeAt) * frac, 8);
          r.h.cancel();
          expectRestored(r);
          expect(r.f.hooked()).toBe(0);
          expect(r.root.children, `${total} ${variant} ${frac}`).toHaveLength(0);
          document.body.innerHTML = '';
        }
      }
    }
  });

  it('both directions at every tier and variant, within the cap, the blow once; the clock never changes speed; the camera applied once; a replay is identical; reduced motion', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of TOTALS) {
        for (const variant of VARIANTS) {
          const a = side === 'player' ? { x: 700, y: 900 } : { x: 1830, y: 90 };
          const d = side === 'player' ? { x: 1830, y: 90 } : { x: 700, y: 900 };
          const r = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total), variant });
          let peak = 0;
          let played = 0;
          for (let i = 0; i < 3000 && !r.h.done; i++) {
            const before = r.h.elapsed();
            r.f.tick(16, 16); played += 16;
            if (!r.h.done) expect(r.h.elapsed() - before).toBe(16);
            peak = Math.max(peak, r.h.scene!.liveSprites);
          }
          expect(played).toBeLessThanOrEqual(r.h.plan.endAt + 32);
          expect(r.onImpact, `${side} ${total} ${variant}`).toHaveBeenCalledTimes(1);
          expect(peak, `${side} ${total} ${variant}`).toBeLessThanOrEqual(MAX_WRESTLE_SPRITES);
          expect(peak, `${side} ${total} ${variant}: well under the cap`).toBeLessThan(MAX_WRESTLE_SPRITES * 0.8);
          expectRestored(r, side === 'opp' ? 'duel-attacker-opp' : 'duel-attacker-player');
          r.h.cancel();
          document.body.innerHTML = '';
        }
      }
    }
    const camera = document.createElement('div');
    camera.appendChild(document.createElement('canvas'));
    const c = run({ camera, total: 40, formation: formationOf([40], 40) });
    tickTo(c, c.h.plan.impactAt + 20);
    expect(c.h.mirrorsCamera).toBe(false);
    expect((c.root.children[0] as Container).scale.x).toBe(1);
    c.h.cancel();
    const x = run({ total: 40, formation: formationOf([40], 40), rollSeed: 5, cfg: C });
    const y = run({ total: 40, formation: formationOf([40], 40), rollSeed: 5, cfg: C });
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.geo).toEqual(y.h.geo);
    tickTo(x, x.h.plan.impactAt + 30); tickTo(y, y.h.plan.impactAt + 30);
    expect(x.attackerEl.style.transform).toBe(y.attackerEl.style.transform);
    expect(x.defenderEl.style.transform).toBe(y.defenderEl.style.transform);
    expect(x.camera.style.transform).toBe(y.camera.style.transform);
    expect(x.h.scene!.liveSprites).toBe(y.h.scene!.liveSprites);
    x.h.cancel(); y.h.cancel();
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expect(r.attackerEl.style.transform).toBe('translateX(3px)');
    expect(r.defenderEl.style.transform).toBe('translateY(2px)');
  });

  it('a knockout for 2 plays the whole finisher (either variant) and lands once', () => {
    for (const variant of VARIANTS) {
      const r = run({ total: 2, knockout: true, formation: formationOf([2], 2), variant });
      expect(r.h.plan.kind).toBe('pin');
      tickTo(r, r.h.plan.impactAt + 12);
      expect(r.onImpact).toHaveBeenCalledTimes(1);
      tickTo(r, r.h.plan.endAt + 32, 8);
      expect(r.onImpact).toHaveBeenCalledTimes(1);
      expectRestored(r);
      document.body.innerHTML = '';
    }
  });
});

describe('the scene (headless Pixi)', () => {
  it('pools, stays under the cap, hides its own objects, drains, and destroy leaves nothing', () => {
    const scene = new HeroWrestleScene(TEX, { mat: 0xe9dfc8, flash: 0xfff4dc, pow: 0xffd23f, hand: 0xef3b2e, spot: 0xfff1c4, side: 0xffcf5a },
      { ropeSize: 1, wordSize: 1, frameW: 1920, frameH: 1080 }, R, R, 1, 9);
    const g = wrestleGeo(A, D, R, R, FRAME, 'pin', C);
    scene.setRing(ringLayout(g, R, R), { visible: true, rise: 1, alpha: 1, near: 0, far: 40, drop: 0 });
    expect(scene.ownVisible).toBe(true);
    scene.setRing(ringLayout(g, R, R), { visible: false, rise: 0, alpha: 0, near: 0, far: 0, drop: 0 });
    expect(scene.ownVisible).toBe(false);
    scene.setSpot({ visible: true, fromX: 100, fromY: 0, toX: 200, toY: 500, alpha: 1 });
    scene.setElbow({ visible: true, x: 10, y: 10, rot: 0, scale: 1 });
    scene.setShadow(D, 0.5);
    scene.setPost({ visible: true, x: 300, foot: 800, top: 300, alpha: 1 });
    scene.setChair({ visible: true, x: 500, y: 500, rot: 0.3, size: 100, burst: 0.4, alpha: 1 });
    scene.setDizzy({ visible: true, x: 500, y: 300, r: 50, phase: 1, alpha: 1 });
    expect(scene.ownVisible).toBe(true);
    for (let i = 0; i < 4; i++) {
      scene.step(A, R, -1); scene.slapArc(D, -1, R); scene.chop(D, A, -1, 2, 8); scene.matRing(D, R, 2, 8); scene.matShock(D, R, 2, 3); scene.flash(D, 0.5); scene.wallop(D, R, 2); scene.ropeTwang(D, 1);
      scene.rush(D, 1, R); scene.count(D, i); scene.matSlap(D, R); scene.bell(D, R); scene.winner(A, R, 2); scene.dizzy(D, R); scene.word('woo', D, 1); scene.word('slam', D, 1);
      scene.word('splash', D, 1); scene.word('bonk', D, 1); scene.crowdFlashes(24, 900); scene.flyBy(D, -1, R); scene.chairBurst(D, R, 2);
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

  it('the chair is seven lengths of light that fly apart as it bursts; the dizzy stars ring the head', () => {
    const scene = new HeroWrestleScene(TEX, { mat: 0, flash: 0, pow: 0, hand: 0, spot: 0, side: 0 }, { ropeSize: 1, wordSize: 1 }, R, R, 1, 9);
    const CHAIR = 0x9fd8ff;
    const chairLens = () => scene.root.children.flatMap((layer) => (layer as Container).children).filter((s) => s.visible && (s as { tint: number }).tint === CHAIR);
    scene.setChair({ visible: true, x: 500, y: 500, rot: 0, size: 120, burst: 0, alpha: 1 });
    const whole = chairLens().map((s) => ({ x: s.x, y: s.y }));
    expect(whole).toHaveLength(7);
    for (const p of whole) expect(dist(p, { x: 500, y: 500 })).toBeLessThan(120);
    scene.setChair({ visible: true, x: 500, y: 500, rot: 0, size: 120, burst: 1, alpha: 0.5 });
    const burst = chairLens();
    expect(burst.reduce((s, q) => s + dist(q, { x: 500, y: 500 }), 0)).toBeGreaterThan(whole.reduce((s, q) => s + dist(q, { x: 500, y: 500 }), 0));
    scene.setChair({ visible: false, x: 0, y: 0, rot: 0, size: 0, burst: 0, alpha: 0 });
    expect(chairLens()).toHaveLength(0);
    scene.destroy();
  });

  it('the ring of light: four pillars and three ropes on EVERY side; a side rope bends OUT and thins when run into, the back and front ropes sag', () => {
    const scene = new HeroWrestleScene(TEX, { mat: 0, flash: 0, pow: 0, hand: 0, spot: 0, side: 0 }, { ropeSize: 1, wordSize: 1 }, R, R, 1, 9);
    const g = wrestleGeo(A, D, R, R, FRAME, 'pin', C);
    const sides = ringLayout(g, R, R);
    const PILLAR = 0xffe2a0;
    type Len = { x: number; y: number; len: number; rot: number; thick: number };
    const lengths = (pillars: boolean): Len[] => scene.root.children.flatMap((layer) => (layer as Container).children)
      .filter((s) => (s as { anchor?: { x: number } }).anchor?.x === 0 && s.visible && ((s as { tint: number }).tint === PILLAR) === pillars)
      .map((s) => ({ x: s.x, y: s.y, len: s.scale.x * 64, rot: s.rotation, thick: s.scale.y }));
    const state = { visible: true, rise: 1, alpha: 1, near: 0, far: 0, drop: 0 };
    scene.setRing(sides, state);
    const pillars = lengths(true);
    expect(pillars).toHaveLength(4);
    for (const q of pillars) expect(q.rot).toBeCloseTo(-Math.PI / 2, 5);
    expect(pillars.map((q) => q.len).sort((a, b) => a - b)[0]!).toBeGreaterThan(R);
    const rest = lengths(false);
    expect(rest).toHaveLength(24);
    const BACK = 0, NEAR = 6, FAR = 12, FRONT = 18;
    for (const at0 of [BACK, FRONT]) for (let i = at0; i < at0 + 6; i += 2) {
      expect(Math.abs(Math.sin(rest[i]!.rot))).toBeLessThan(0.01);
      expect(rest[i]!.len + rest[i + 1]!.len).toBeGreaterThan(R * 5);
    }
    scene.setRing(sides, { ...state, far: 60 });
    const pushed = lengths(false);
    for (const at0 of [BACK, NEAR, FRONT]) for (let i = at0; i < at0 + 6; i++) expect(pushed[i]).toEqual(rest[i]);
    for (let i = FAR; i < FAR + 6; i += 2) {
      expect((pushed[i + 1]!.x - rest[i + 1]!.x) * sides[1].out).toBeGreaterThan(40);
      expect(pushed[i]!.len).toBeGreaterThan(rest[i]!.len);
      expect(pushed[i]!.thick).toBeLessThan(rest[i]!.thick);
    }
    scene.setRing(sides, { ...state, drop: 30 });
    const sagged = lengths(false);
    for (const at0 of [BACK, FRONT]) for (let i = at0; i < at0 + 6; i += 2) expect(sagged[i + 1]!.y - rest[i + 1]!.y).toBeGreaterThan(15);
    for (let i = NEAR; i < FRONT; i++) expect(sagged[i]).toEqual(rest[i]);
    scene.hideOwn();
    expect(lengths(false)).toHaveLength(0);
    expect(lengths(true)).toHaveLength(0);
    scene.destroy();
  });
});
