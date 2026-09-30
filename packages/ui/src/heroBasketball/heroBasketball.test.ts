// @vitest-environment jsdom
/**
 * THE BASKETBALL HERO ATTACK ("Nothing But Net", Legendary; owner 2026-09-29: "tier 1 = basketball shot from place /
 * tier 2 = a fadeaway ...", reviewed the same day: "let's make the tier 3 another like it ... pulls up for a 3. for the
 * huge self alley oop - have the attacker chuck the ball from its starting position, and then run up and leap from half
 * court"): the shared tiers onto the four moves; the tuner values; the pure plan (the blow lands ONCE: the swish or the
 * slam; the pass, the pump fake, the chuck and the catch never touch the target); the geometry (mid court between the
 * heroes, the fade backwards and to one side, the scoot straight up court, the pass from off the right edge, half court,
 * the catch above the target, every point on screen even with the target tucked in a corner, the ball always landing on
 * the target's centre); the pure pose
 * and ball; the runner (the portrait's transform, opacity and z-order restored exactly on the end, finish, cancel and
 * the safety timer; the ball, shadows and hoop hidden; the camera applied once); the scene; the sounds; the cosmetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  HERO_BASKETBALL_CLIP_KEYS, HERO_BASKETBALL_DEFAULTS, HERO_BASKETBALL_RANGES, arcHeight, basketballBall, basketballCameraAt, basketballCues,
  basketballGeo, basketballKind, basketballPlan, basketballPose, basketballTimeScale, clampHeroBasketballValue, heroBasketballConfigJson, hoopAt, poseSegs,
  slowExtraMs, slowWindow, variantOf, type BasketballVariant,
  type HeroBasketballNumKey,
} from './heroBasketballConfig';
import { HeroBasketballScene, MAX_BASKETBALL_SPRITES, type HeroBasketballTextures } from './heroBasketballScene';
import { playHeroBasketball, type HeroBasketballOptions } from './heroBasketball';
import { SPEC } from '../HeroBasketballTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroBasketballTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  ball: W, shadow: W, rim: W, net: W, board: W, shard: W, confetti: W, wordSwish: W, wordSlam: W,
};
const C = HERO_BASKETBALL_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean } = {}) => basketballPlan({ total, leadIn: leadInOf([total], o.reduced), ...o }, C);
const A = { x: 960, y: 900 }, D = { x: 960, y: 200 };
const R = 80;
const FRAME = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
const ctx = (total: number, a = A, d = D) => {
  const p = plan(total);
  const g = basketballGeo(a, d, R, R, FRAME, C);
  const segs = poseSegs(p, g, C, a, R);
  return { p, g, segs, c: C, a, aR: R, frame: FRAME };
};
const dist = (p: { x: number; y: number }, q: { x: number; y: number }): number => Math.hypot(p.x - q.x, p.y - q.y);

describe('the tiers: the shared four onto the four moves', () => {
  it('uses the shared thresholds; I jumper, II fadeaway, III pull-up three, IV alley-oop; a knockout plays the alley-oop', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).kind, `dmg ${d}`).toBe(basketballKind(tierOf(d)));
    expect([1, 2, 3, 4].map((t) => basketballKind(t as 1 | 2 | 3 | 4))).toEqual(['jumper', 'fadeaway', 'three', 'alleyoop']);
    expect(plan(2, { knockout: true })).toMatchObject({ tier: 4, kind: 'alleyoop' });
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; buttons on top; a clip row per sound', () => {
    for (const [k, [min, max]] of Object.entries(HERO_BASKETBALL_RANGES)) {
      const v = C[k as HeroBasketballNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroBasketballValue('alleyRise', 99)).toBe(4);
    expect(clampHeroBasketballValue('colorBall', 'nope')).toBe(C.colorBall);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroBasketballConfigJson(C)).previewDamage).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    expect((SPEC.actions ?? []).map((a) => a.label).filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
    expect(DEV_HERO_ATTACK_CHOICES).toContain('basketball');
    // Every sound cue has its own clip / gain / pitch row.
    for (const k of HERO_BASKETBALL_CLIP_KEYS) {
      expect(keys.has(k as never), k).toBe(true);
      expect(keys.has(k.replace('Clip', 'Gain') as never), k).toBe(true);
      expect(keys.has(k.replace('Clip', 'Rate') as never), k).toBe(true);
    }
  });

  it('the sounds: a whistle, the crowd "ooh", dribbles, the swish, the rim and the sneakers are their own clips, and every default clip exists', async () => {
    expect(C.sfxWhistleClip).toBe('fx/bball-whistle');
    expect(C.sfxOohClip).toBe('fx/bball-ooh');
    expect(C.sfxDribbleClip).toBe('fx/bball-dribble');
    expect(C.sfxSwishClip).toBe('fx/bball-swish');
    expect(C.sfxRimClip).toBe('fx/bball-rim');
    expect(C.sfxSqueakClip).toBe('fx/bball-squeak');
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const k of HERO_BASKETBALL_CLIP_KEYS) {
      const id = C[k];
      const base = resolve(__dirname, '../audio', id);
      expect(existsSync(`${base}.mp3`) || existsSync(`${base}.wav`), `${k} = ${id}`).toBe(true);
    }
  });
});

describe('the plan', () => {
  it('I THE JUMPER: dribbles where it stands, jumps, releases near the top, the swish is THE impact; nothing moves it along the floor', () => {
    const p = plan(3);
    expect(p.kind).toBe('jumper');
    expect(p.approachEnd).toBe(p.startAt);
    expect(p.dribbles.length).toBe(C.t1Dribbles);
    expect(p.releaseAt!).toBeGreaterThan(p.takeoffAt);
    expect(p.releaseAt!).toBeLessThan(p.landAt);
    expect(p.impactAt).toBe(p.releaseAt! + C.t1FlightMs);
    expect(p.catchAt).toBeNull();
    expect(p.passAt).toBeNull();
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(2200);
  });

  it('II THE FADEAWAY: a slide to mid court (squeaks), the fade, the release at the top of the fade, swish, then home', () => {
    const p = plan(8);
    expect(p.kind).toBe('fadeaway');
    expect(p.approachEnd).toBeGreaterThan(p.startAt);
    expect(p.squeaks.length).toBeGreaterThanOrEqual(3);
    expect(p.releaseAt!).toBeGreaterThan(p.takeoffAt);
    expect(p.releaseAt!).toBeLessThan(p.landAt);
    expect(p.homeAt).toBeGreaterThan(p.impactAt);
    expect(p.homeEnd).toBeGreaterThan(p.homeAt);
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(3000);
  });

  it('III THE THREE: the scoot, the pass caught after it stops, the pump fake, the dribble back, the pull-up; the swish = THE impact', () => {
    const p = plan(14);
    expect(p.kind).toBe('three');
    expect(p.passAt!).toBeLessThan(p.catchAt!);
    expect(p.catchAt!).toBeGreaterThan(p.approachEnd);
    expect(p.pumpAt!).toBeGreaterThan(p.catchAt!);
    expect(p.backAt!).toBeGreaterThanOrEqual(p.pumpEnd!);
    expect(p.dribbles.length).toBe(C.t3Dribbles);
    expect(p.dribbles.every((t) => t >= p.backAt! && t <= p.backEnd!)).toBe(true);
    expect(p.takeoffAt).toBeGreaterThan(p.backEnd!);
    expect(p.releaseAt).toBeGreaterThan(p.takeoffAt);
    expect(p.releaseAt).toBeLessThan(p.landAt);
    expect(p.impactAt).toBe(p.releaseAt + C.t3FlightMs);
    expect(p.homeAt).toBeGreaterThan(p.impactAt);
    const kinds = basketballCues(p).map((q) => q.kind);
    for (const k of ['pass', 'catch', 'pump', 'release', 'impact'] as const) expect(kinds.filter((q) => q === k), k).toHaveLength(1);
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(4200);
  });

  it('IV THE ALLEY-OOP: a fast throw from the start, the smack (a TICK), the high bounce, the leap timed to the catch, the slam = THE impact', () => {
    const p = plan(40);
    expect(p.kind).toBe('alleyoop');
    expect(p.dribbles).toEqual([]); // a direct throw from the beginning
    expect(p.releaseAt - p.startAt).toBeLessThan(200);
    expect(p.bounceAt!).toBe(p.releaseAt + C.t4FlightMs);
    expect(C.t4FlightMs).toBeLessThanOrEqual(320); // fast
    expect(p.catchAt!).toBe(p.bounceAt! + C.riseMs);
    expect(p.releaseAt).toBeLessThan(p.approachAt);
    expect(p.takeoffAt).toBeGreaterThanOrEqual(p.approachEnd);
    expect(p.catchAt!).toBe(p.takeoffAt + C.t4LeapMs);
    expect(p.slamAt!).toBeGreaterThan(p.catchAt!);
    expect(p.impactAt).toBe(p.slamAt! + C.t4SlamMs);
    expect(p.passAt).toBeNull();
    const kinds = basketballCues(p).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'catch')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'bounce')).toHaveLength(1);
    expect(kinds.indexOf('bounce')).toBeLessThan(kinds.indexOf('impact'));
    expect(kinds[0]).toBe('charge');
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(3500);
  });

  it('every tier: exactly one impact cue, a whistle (charge) first, no hit-stop anywhere', () => {
    for (const total of [3, 8, 14, 40]) {
      const p = plan(total);
      const cues = basketballCues(p);
      expect(cues.filter((q) => q.kind === 'impact'), `${total}`).toHaveLength(1);
      expect(cues[0]!.kind).toBe('charge');
      expect(Object.keys(p).join(' ')).not.toMatch(/hitStop|freeze/i);
    }
  });

  it('reduced motion: the portrait never moves, no ball; the blow lands at the end of the formation', () => {
    const p = plan(40, { reduced: true });
    expect(p.impactAt).toBe(leadInOf([40], true));
    const g = basketballGeo(A, D, R, R, FRAME, C);
    const segs = poseSegs(p, g, C, A, R);
    for (let t = 0; t < p.endAt + 200; t += 50) {
      expect(basketballPose(p, segs, C, t)).toMatchObject({ x: 0, y: 0, scale: 1 });
      expect(basketballBall({ p, g, segs, c: C, a: A, aR: R, frame: FRAME }, t).visible).toBe(false);
    }
  });
});

describe('the geometry', () => {
  it('mid court sits between the heroes; the fade goes BACK and to a side; the scoot goes STRAIGHT up court; the pass comes from off the right edge', () => {
    const g = basketballGeo(A, D, R, R, FRAME, C);
    expect(g.mid.y).toBeLessThan(A.y);
    expect(g.mid.y).toBeGreaterThan(D.y);
    expect(g.fade.y).toBeGreaterThan(g.mid.y); // backwards: away from the target (which is up)
    expect(Math.abs(g.fade.x - g.mid.x)).toBeGreaterThan(R); // and to one side
    expect(g.scoot.x).toBe(A.x); // straight
    expect(g.scoot.y).toBeCloseTo(A.y - R * C.scootUp, 6); // up
    expect(g.passFrom.x).toBeGreaterThan(FRAME.x1); // off the right edge
    expect(g.back.y).toBeGreaterThan(g.scoot.y); // the step back is away from the target
    expect(dist(g.half, D)).toBeGreaterThanOrEqual(2 * R);
    expect(g.half.y).toBeLessThan(A.y);
    expect(g.up.y).toBeLessThan(-0.9); // room above the target: straight up
    expect(g.ballApex.y).toBeLessThan(D.y);
    // a foe striking from the top scoots DOWN court (toward you)
    const f = basketballGeo(D, A, R, R, FRAME, C);
    expect(f.scoot.y).toBeGreaterThan(D.y);
  });

  it('a target tucked in the top-right corner: every point on screen, and every shot and slam still lands on its centre', () => {
    for (const [a, d] of [[{ x: 700, y: 900 }, { x: 1830, y: 90 }], [{ x: 1830, y: 90 }, { x: 700, y: 900 }], [{ x: 120, y: 980 }, { x: 1800, y: 100 }]] as const) {
      const g = basketballGeo(a, d, R, R, FRAME, C);
      const m = R * 0.9 * 0.5;
      for (const [name, q] of Object.entries({ mid: g.mid, fade: g.fade, scoot: g.scoot, back: g.back, half: g.half, catchAt: g.catchAt, ballApex: g.ballApex })) {
        expect(q.x, name).toBeGreaterThanOrEqual(m * 0.8 - 1e-6);
        expect(q.x, name).toBeLessThanOrEqual(1920 - m * 0.8 + 1e-6);
        expect(q.y, name).toBeGreaterThanOrEqual(m * 0.8 - 1e-6);
        expect(q.y, name).toBeLessThanOrEqual(1080 - m * 0.8 + 1e-6);
      }
      expect(g.hit).toEqual(d);
      expect(dist(g.contact, d)).toBeLessThanOrEqual(R);
      // every tier's ball lands on the target's centre at the impact, and never leaves the top of the screen
      for (const total of [3, 8, 14, 40]) {
        const x = { ...ctx(total, a, d) };
        const b = basketballBall(x, x.p.impactAt);
        expect(dist(b, d), `${total}`).toBeLessThan(1);
        for (let t = x.p.chargeAt; t < x.p.impactAt; t += 16) {
          const bt = basketballBall(x, t);
          if (bt.visible) expect(bt.y, `${total} @${t}`).toBeGreaterThanOrEqual(-1);
        }
      }
    }
  });

  it('the arc is trimmed so the ball stays on screen', () => {
    const h = arcHeight({ x: 900, y: 120 }, { x: 1300, y: 100 }, 0.9, FRAME, 20);
    expect(h).toBeLessThan(100);
    expect(arcHeight({ x: 900, y: 900 }, { x: 900, y: 200 }, 0.3, FRAME, 20)).toBeCloseTo(210, 0);
  });
});

describe('the pose and the ball', () => {
  it('I: in the air at the release, home on the floor after the landing; the ball in flight arcs ABOVE the straight line', () => {
    const x = ctx(3);
    const at = (t: number) => basketballPose(x.p, x.segs, C, t);
    expect(at(x.p.chargeAt - 1)).toMatchObject({ x: 0, y: 0, air: 0 });
    expect(at(x.p.releaseAt!).air).toBeGreaterThan(0.5);
    expect(at(x.p.releaseAt!).y).toBeLessThan(0);
    expect(at(x.p.landAt + 1)).toMatchObject({ x: 0, y: 0 });
    const mid = (x.p.releaseAt! + x.p.impactAt) / 2;
    const b = basketballBall(x, mid);
    expect(b.flying).toBe(true);
    const from = basketballBall(x, x.p.releaseAt!);
    expect(b.y).toBeLessThan((from.y + D.y) / 2 - 20);
    // backspin: the ball turns as it flies
    expect(basketballBall(x, mid + 100).rot).not.toBe(b.rot);
  });

  it('II: at mid court, then fading back to its side at the release, home at the end', () => {
    const x = ctx(8);
    const at = (t: number) => basketballPose(x.p, x.segs, C, t);
    const m = at(x.p.approachEnd);
    expect(dist({ x: A.x + m.x, y: A.y + m.y }, x.g.mid)).toBeLessThan(1);
    const r = at(x.p.releaseAt!);
    expect(r.air).toBeGreaterThan(0.5);
    expect(Math.abs(A.x + r.x - x.g.mid.x)).toBeGreaterThan(R * 0.5); // drifting to the side
    { const e = at(x.p.endAt - 1); expect(Math.hypot(e.x, e.y)).toBeLessThan(0.05); }
  });

  it('III: scooted straight up, no ball until the pass flies in from the right into the hands; the pump fake lifts it; the step back; the pull-up swish', () => {
    const x = ctx(14);
    const at = (t: number) => basketballPose(x.p, x.segs, C, t);
    const s0 = at(x.p.approachEnd);
    expect(dist({ x: A.x + s0.x, y: A.y + s0.y }, x.g.scoot)).toBeLessThan(1);
    expect(basketballBall(x, x.p.passAt! - 1).visible).toBe(false);
    const enter = basketballBall(x, x.p.passAt! + 1);
    expect(enter.visible).toBe(true);
    expect(enter.x).toBeGreaterThan(FRAME.x1 - 10); // entering from the right edge
    const caught = basketballBall(x, x.p.catchAt!);
    const held = basketballBall(x, x.p.catchAt! + 1);
    expect(dist(caught, held)).toBeLessThan(3); // lands in the hands
    const pumpTop = basketballBall(x, (x.p.pumpAt! + x.p.pumpEnd!) / 2);
    expect(pumpTop.y).toBeLessThan(held.y - R * 0.3); // the pump fake lifts it
    expect(basketballBall(x, x.p.pumpEnd! + 20).y).toBeGreaterThan(pumpTop.y + R * 0.3); // and pulls it back down
    const b = at(x.p.backEnd!);
    expect(dist({ x: A.x + b.x, y: A.y + b.y }, x.g.back)).toBeLessThan(1);
    expect(at(x.p.releaseAt).air).toBeGreaterThan(0.5);
    expect(basketballBall(x, (x.p.releaseAt + x.p.impactAt) / 2).flying).toBe(true);
    expect(dist(basketballBall(x, x.p.impactAt), D)).toBeLessThan(1);
    { const e = at(x.p.endAt - 1); expect(Math.hypot(e.x, e.y)).toBeLessThan(0.05); }
  });

  it('IV: fired flat from the slot straight at the target, it bounces HIGH, the portrait leaps and meets it at the top, then slams', () => {
    const x = ctx(40);
    const at = (t: number) => basketballPose(x.p, x.segs, C, t);
    // the throw leaves from the slot (the portrait has not left it)
    const r = at(x.p.releaseAt);
    expect(Math.hypot(r.x, r.y)).toBeLessThan(R * 0.2);
    // flat and direct: mid-flight it is within a few px of the straight line to the target
    const from = basketballBall(x, x.p.releaseAt);
    const mid = basketballBall(x, (x.p.releaseAt + x.p.bounceAt!) / 2);
    expect(mid.flying).toBe(true);
    expect(dist(mid, { x: (from.x + D.x) / 2, y: (from.y + D.y) / 2 })).toBeLessThan(0.05 * dist(from, D) + 1);
    // it smacks the target, then rises HIGH (well above it) to where it is caught
    expect(dist(basketballBall(x, x.p.bounceAt!), D)).toBeLessThan(1);
    expect(basketballBall(x, x.p.bounceAt! + 1).visible).toBe(true);
    // (with room above the target it goes the full bounce height, straight up)
    const room = ctx(40, A, { x: 960, y: 520 });
    expect(room.g.ballApex.y).toBeCloseTo(520 - R * C.alleyRise, 6);
    expect(room.g.ballApex.x).toBeCloseTo(960, 6);
    const h = at(x.p.approachEnd);
    expect(dist({ x: A.x + h.x, y: A.y + h.y }, x.g.half)).toBeLessThan(1);
    expect(at(x.p.catchAt!).air).toBe(1);
    const top = basketballBall(x, x.p.catchAt! - 0.01);
    expect(dist(top, x.g.ballApex)).toBeLessThan(2);
    const hero = basketballPose(x.p, x.segs, C, x.p.catchAt!);
    expect(dist({ x: A.x + hero.x, y: A.y + hero.y }, x.g.catchAt)).toBeLessThan(1);
    // the ball in the hands just after the catch sits on the portrait's "up" side, near where it was caught
    expect(dist(basketballBall(x, x.p.catchAt! + 1), x.g.ballApex)).toBeLessThan(R * 0.5);
    expect(dist(basketballBall(x, x.p.impactAt), D)).toBeLessThan(1);
  });

  it('the hoop shows before the shot lands, rattles on the slam, and IV\'s backboard is gone after it; the camera pushes in at IV', () => {
    const p = plan(40);
    expect(hoopAt(p, p.chargeAt).alpha).toBe(0);
    expect(hoopAt(p, p.impactAt - 1)).toMatchObject({ board: true });
    expect(hoopAt(p, p.impactAt - 1).alpha).toBeGreaterThan(0.9);
    expect(hoopAt(p, p.impactAt + 30).board).toBe(false);
    expect(Math.abs(hoopAt(p, p.impactAt + 20).rattle)).toBeGreaterThan(0);
    expect(hoopAt(p, p.endAt).alpha).toBe(0);
    expect(basketballCameraAt(p, C, p.impactAt - 1, { x: 0, y: 1 }).zoom).toBeGreaterThan(1.05);
    expect(basketballCameraAt(p, C, p.chargeAt, { x: 0, y: 1 }).zoom).toBe(1);
  });
});

function manualFrames(): { frames: HeroBasketballOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

/** Tick real frames until the attack's own clock reaches `t` (slow mo makes real time and attack time differ). */
function tickTo(r: { h: { elapsed(): number; done: boolean }; f: { tick: (ms: number, step?: number) => void } }, t: number, step = 4): void {
  for (let i = 0; i < 20000 && !r.h.done && r.h.elapsed() < t; i++) r.f.tick(step, step);
}

function run(over: Partial<HeroBasketballOptions> = {}) {
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
  camera.append(attackerEl, defenderEl);
  document.body.append(host, camera);
  const h = playHeroBasketball({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: { x: 960, y: 900 }, defender: { x: 960, y: 200 }, defenderRadius: R, attackerRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

/** The portrait and the page are back EXACTLY as they were, and nothing of the attack is left drawing. */
function expectRestored(r: ReturnType<typeof run>, zClass = 'duel-attacker-player'): void {
  expect(r.attackerEl.style.transform).toBe('translateX(3px)');
  expect(r.attackerEl.style.opacity).toBe('0.95');
  expect(r.defenderEl.style.transform).toBe('');
  expect(r.camera.style.transform).toBe('');
  expect(document.body.classList.contains(zClass)).toBe(false);
  expect(r.host.querySelector('.hblast')).toBeNull();
  expect(r.h.scene?.ownVisible ?? false).toBe(false);
}

describe('the runner (the shared clock, the portrait restored on every exit)', () => {
  afterEach(() => { document.body.innerHTML = ''; document.body.className = ''; });

  it('IV: the smack, the bounce and the catch never land it; the blow lands ONCE on the slam; the portrait moved, raised, and is put back EXACTLY at the end', () => {
    const r = run({ total: 40, formation: formationOf([40], 40) });
    const { h, f, onImpact, onDone } = r;
    expect(r.host.querySelector('.hblast.hbasketball')).not.toBeNull();
    tickTo(r, h.plan.bounceAt! + 8);
    expect(onImpact).not.toHaveBeenCalled(); // the smack is a tick
    tickTo(r, h.plan.catchAt! + 8);
    expect(onImpact).not.toHaveBeenCalled();
    expect(document.body.classList.contains('duel-attacker-player')).toBe(true);
    expect(r.attackerEl.style.transform).toContain('translate(');
    expect(h.scene!.ownVisible).toBe(true); // the ball and the hoop are up
    tickTo(r, h.plan.impactAt - 12);
    expect(onImpact).not.toHaveBeenCalled();
    tickTo(r, h.plan.impactAt + 12);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(r.host.querySelector('.hblast-hit')!.textContent).toBe('-40');
    expect(r.defenderEl.style.transform).toContain('translate(');
    tickTo(r, h.plan.endAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
    f.tick(4000, 16);
    expect(f.hooked()).toBe(0);
    expect(r.root.children).toHaveLength(0);
  });

  it('cancel() mid-leap, finish() mid-fade and the safety timer each put the portrait back exactly (cancel never lands)', () => {
    const a = run({ total: 14, formation: formationOf([14], 14) });
    tickTo(a, a.h.plan.apexAt - 30);
    expect(a.attackerEl.style.transform).toContain('translate(');
    a.h.cancel();
    expect(a.onImpact).not.toHaveBeenCalled();
    expectRestored(a);
    expect(a.f.hooked()).toBe(0);
    document.body.innerHTML = '';

    const b = run({ total: 8, formation: formationOf([8], 8), side: 'opp', attacker: { x: 960, y: 200 }, defender: { x: 960, y: 900 } });
    tickTo(b, b.h.plan.takeoffAt + 60);
    expect(b.attackerEl.style.transform).toContain('translate(');
    b.h.finish();
    expect(b.onImpact).toHaveBeenCalledTimes(1);
    expectRestored(b, 'duel-attacker-opp');
    document.body.innerHTML = '';

    vi.useFakeTimers();
    try {
      const c = run({ total: 40, formation: formationOf([40], 40), safety: true });
      tickTo(c, c.h.plan.catchAt! + 20);
      vi.advanceTimersByTime(c.h.plan.endAt + 3000);
      expect(c.onImpact).toHaveBeenCalledTimes(1);
      expect(c.h.done).toBe(true);
      expectRestored(c);
    } finally { vi.useRealTimers(); }
  });

  it('an unmount mid-attack (Recruit cancels the handle) leaves no transform, no class and no drawn ball behind, at every tier', () => {
    for (const total of [3, 8, 14, 40]) {
      const r = run({ total, formation: formationOf([total], total) });
      const mid = (r.h.plan.takeoffAt + r.h.plan.impactAt) / 2;
      tickTo(r, mid);
      r.h.cancel();
      expectRestored(r);
      expect(r.f.hooked()).toBe(0);
      expect(r.root.children, `${total}`).toHaveLength(0);
      document.body.innerHTML = '';
    }
  });

  it('both directions at every tier, within the cap, the blow once; the camera applied once; a replay is identical; reduced motion', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 700, y: 900 } : { x: 1830, y: 90 };
        const d = side === 'player' ? { x: 1830, y: 90 } : { x: 700, y: 900 };
        const r = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let i = 0; i < 2000 && !r.h.done; i++) { r.f.tick(16, 16); peak = Math.max(peak, r.h.scene!.liveSprites); }
        expect(r.onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak, `${side} ${total}`).toBeLessThanOrEqual(MAX_BASKETBALL_SPRITES);
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
    const x = run({ total: 40, formation: formationOf([40], 40) });
    const y = run({ total: 40, formation: formationOf([40], 40) });
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.geo).toEqual(y.h.geo);
    x.h.cancel(); y.h.cancel();
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expect(r.attackerEl.style.transform).toBe('translateX(3px)');
  });
});

describe('variety (owner review of #1867: three dribble moves on II, three spots on III, rolled per blow)', () => {
  const vctx = (total: number, v: BasketballVariant, a = A, d = D) => {
    const p = basketballPlan({ total, leadIn: leadInOf([total]), variant: v }, C);
    const g = basketballGeo(a, d, R, R, FRAME, C, v);
    return { p, g, segs: poseSegs(p, g, C, a, R), c: C, a, aR: R, frame: FRAME };
  };

  it('the roll is stable per seed, covers all three, and the DEV override forces one', () => {
    const seen = new Set<number>();
    for (let s0 = 0; s0 < 60; s0++) { expect(variantOf(s0, C)).toBe(variantOf(s0, C)); seen.add(variantOf(s0, C)); }
    expect([...seen].sort()).toEqual([1, 2, 3]);
    for (const v of ['1', '2', '3']) expect(variantOf(12345, { ...C, variation: v })).toBe(Number(v));
    expect(clampHeroBasketballValue('variation', '2')).toBe('2');
  });

  it('II: every dribble move keeps the fade and the shot; the wrap HIDES the ball behind the portrait; the spin turns it a full circle', () => {
    for (const v of [1, 2, 3] as const) {
      const x = vctx(8, v);
      expect(x.p.flairAt!).toBeGreaterThan(x.p.startAt);
      expect(x.p.flairEnd!).toBeLessThan(x.p.approachEnd);
      expect(dist(basketballBall(x, x.p.impactAt), D), `v${v}`).toBeLessThan(1);
      const m = basketballPose(x.p, x.segs, C, x.p.approachEnd);
      expect(dist({ x: A.x + m.x, y: A.y + m.y }, x.g.mid), `v${v}`).toBeLessThan(1);
    }
    const wrap = vctx(8, 1);
    // the wrap is slow enough to read (owner on 5173: "slow the around the back down so it's cleaner"): its own length,
    // about twice the first build's (~230 ms), with the fade and the shot still following the slide
    expect(wrap.p.flairEnd! - wrap.p.flairAt!).toBe(C.wrapMs);
    expect(C.wrapMs).toBeGreaterThanOrEqual(1.5 * 230);
    expect(wrap.p.flairEnd!).toBeLessThan(wrap.p.approachEnd);
    expect(wrap.p.takeoffAt - wrap.p.approachEnd).toBe(C.gatherMs);
    let hidden = 0, shown = 0;
    for (let t = wrap.p.flairAt!; t < wrap.p.flairEnd!; t += 8) { const b = basketballBall(wrap, t); if (!b.visible) hidden++; else shown++; }
    expect(hidden).toBeGreaterThan(0);
    expect(shown).toBeGreaterThan(hidden);
    const spin = vctx(8, 3);
    const r0 = basketballPose(spin.p, spin.segs, C, spin.p.flairAt!).rot, r1 = basketballPose(spin.p, spin.segs, C, spin.p.flairEnd! - 0.01).rot;
    expect(Math.abs(r1 - r0)).toBeGreaterThan(350);
    const cross = vctx(8, 2);
    expect(cross.p.dribbles.length).toBe(4);
  });

  it('III: three spots (straight up, the left wing, the right corner), the pass from the side the spot faces, on screen, the shot on target', () => {
    const spots = [1, 2, 3].map((v) => vctx(14, v as BasketballVariant));
    expect(spots[0]!.g.scoot.x).toBeCloseTo(A.x, 6);
    expect(spots[1]!.g.scoot.x).toBeLessThan(A.x - R);
    expect(spots[2]!.g.scoot.x).toBeGreaterThan(A.x + R);
    expect(spots[1]!.g.passFrom.x).toBeLessThan(FRAME.x0);
    expect(spots[0]!.g.passFrom.x).toBeGreaterThan(FRAME.x1);
    expect(spots[2]!.g.passFrom.x).toBeGreaterThan(FRAME.x1);
    for (const [a, d] of [[A, D], [{ x: 120, y: 980 }, { x: 1800, y: 100 }], [{ x: 1830, y: 90 }, { x: 700, y: 900 }]] as const) {
      for (const v of [1, 2, 3] as const) {
        const x = vctx(14, v, a, d);
        for (const q of [x.g.scoot, x.g.back]) {
          expect(q.x).toBeGreaterThanOrEqual(R - 1e-6); expect(q.x).toBeLessThanOrEqual(1920 - R + 1e-6);
          expect(q.y).toBeGreaterThanOrEqual(R - 1e-6); expect(q.y).toBeLessThanOrEqual(1080 - R + 1e-6);
        }
        expect(dist(basketballBall(x, x.p.impactAt), d), `v${v}`).toBeLessThan(1);
        const caught = basketballBall(x, x.p.catchAt!), held = basketballBall(x, x.p.catchAt! + 1);
        expect(dist(caught, held), `v${v} catch`).toBeLessThan(3);
      }
    }
  });
});

describe('slow mo (III on the release, IV on the catch; a smooth ramp, never a freeze)', () => {
  it('III slows around the release and IV around the catch, then IV runs a touch fast through the slam; never 0; I and II never slow', () => {
    const three = plan(14), oop = plan(40);
    expect(basketballTimeScale(three, C, three.releaseAt)).toBeCloseTo(C.threeSlow, 6);
    expect(basketballTimeScale(three, C, three.takeoffAt - 300)).toBe(1);
    expect(basketballTimeScale(three, C, three.impactAt)).toBe(1);
    expect(basketballTimeScale(oop, C, oop.catchAt!)).toBeCloseTo(C.alleySlow, 6);
    expect(basketballTimeScale(oop, C, (oop.slamAt! + oop.impactAt) / 2)).toBeGreaterThan(1);
    for (const p of [plan(3), plan(8)]) for (let t = 0; t < p.endAt; t += 5) expect(basketballTimeScale(p, C, t)).toBe(1);
    for (const p of [three, oop]) {
      let min = 1, prev = basketballTimeScale(p, C, 0);
      for (let t = 0; t < p.endAt; t += 1) {
        const k = basketballTimeScale(p, C, t);
        min = Math.min(min, k);
        expect(Math.abs(k - prev), `smooth @${t}`).toBeLessThan(0.08); // a ramp, never a hard stop
        prev = k;
      }
      expect(min).toBeGreaterThan(0.2);
      expect(slowWindow(p, C)).not.toBeNull();
    }
    // the extra real time is about the slow-mo length (minus the fast slam on IV)
    expect(slowExtraMs(three, C)).toBeGreaterThan(C.threeSlowMs * (1 - C.threeSlow) * 0.6);
    expect(slowExtraMs(three, C)).toBeLessThan(C.threeSlowMs * 1.2);
    expect(slowExtraMs(plan(8), C)).toBe(0);
  });

  it('the runner: the clock really slows (real ms per attack ms), the blow still lands once, and it ends later by about the slow mo', () => {
    for (const total of [14, 40]) {
      const r = run({ total, formation: formationOf([total], total) });
      tickTo(r, (total === 14 ? r.h.plan.releaseAt : r.h.plan.catchAt!) - 2, 2);
      const before = r.h.elapsed();
      r.f.tick(16, 16);
      expect(r.h.elapsed() - before, `${total}`).toBeLessThan(16 * 0.6);
      expect(r.h.elapsed() - before, `${total}`).toBeGreaterThan(0);
      let real = 0;
      while (!r.h.done && real < 20000) { r.f.tick(16, 16); real += 16; }
      expect(r.onImpact).toHaveBeenCalledTimes(1);
      expect(r.h.done).toBe(true);
      expect(r.attackerEl.style.transform).toBe('translateX(3px)');
      document.body.innerHTML = '';
    }
  });

  it('every variation restores the portrait on every exit (end, finish, cancel)', () => {
    for (const variation of ['1', '2', '3']) {
      for (const total of [8, 14]) {
        const cfg = { ...C, variation };
        const e = run({ total, formation: formationOf([total], total), cfg });
        expect(e.h.variant).toBe(Number(variation));
        for (let i = 0; i < 2000 && !e.h.done; i++) e.f.tick(16, 16);
        expectRestored(e);
        document.body.innerHTML = '';
        const f = run({ total, formation: formationOf([total], total), cfg });
        tickTo(f, f.h.plan.flairAt ?? f.h.plan.catchAt!);
        f.h.finish();
        expect(f.onImpact).toHaveBeenCalledTimes(1);
        expectRestored(f);
        document.body.innerHTML = '';
        const c = run({ total, formation: formationOf([total], total), cfg });
        tickTo(c, (c.h.plan.flairAt ?? c.h.plan.releaseAt) + 30);
        c.h.cancel();
        expect(c.onImpact).not.toHaveBeenCalled();
        expectRestored(c);
        document.body.innerHTML = '';
      }
    }
  });
});

describe('the scene (headless Pixi)', () => {
  it('pools, stays under the cap, hides its own objects, drains, and destroy leaves nothing', () => {
    const scene = new HeroBasketballScene(TEX, {
      ball: 0xe8742a, rim: 0xff5a1f, net: 0xffffff, glass: 0xcfeeff, flash: 0xfff4dc, blast: 0xff7a1a, confettiA: 0xffd23f, confettiB: 0x3fa9ff, side: 0xffcf5a,
    }, { ballSize: 0.5, shadowDrop: 0.5, hoopSize: 1, wordSize: 1 }, R, R, 1, 9);
    scene.setBall({ visible: true, x: 10, y: 10, rot: 0, scale: 1, alpha: 1, air: 0.5, squash: 0.1, flying: true });
    scene.setHeroShadow({ x: 0, y: 0 }, 0.6, 1);
    scene.setHoop(D, 1, 0.1, true);
    expect(scene.ownVisible).toBe(true);
    for (let i = 0; i < 3; i++) {
      scene.dribble(A, 1); scene.squeak(A, { x: 0, y: -1 }); scene.release(A); scene.swish(D, 1.5, { rings: 6, confetti: 80 }); scene.bounce(D); scene.catchFlash(D, 0.6);
      scene.slam(D, { x: 0, y: 1 }, { burst: 2, rings: 8, shards: 40, confetti: 80, blast: 3 });
      scene.trail({ visible: true, x: 5, y: 5, rot: 0, scale: 1, alpha: 1, air: 0.2, squash: 0, flying: true });
    }
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_BASKETBALL_SPRITES);
    scene.hideOwn();
    expect(scene.ownVisible).toBe(false);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    expect(scene.liveSprites).toBe(0);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });
});

describe('the cosmetic', () => {
  it('Nothing But Net (attack_basketball) is a LEGENDARY crate hero attack that plays the basketball', () => {
    expect(COSMETIC_INDEX.attack_basketball).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: 'Nothing But Net', assets: { style: 'basketball' }, active: true });
    expect(HERO_ATTACK_STYLES).toContain('basketball');
    expect(styleOfCosmetic('attack_basketball')).toBe('basketball');
  });
});
