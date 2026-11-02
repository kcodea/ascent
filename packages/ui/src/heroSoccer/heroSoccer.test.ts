// @vitest-environment jsdom
/**
 * THE SOCCER HERO ATTACK ("Golazo", Legendary; owner 2026-11-02: "make 2 attack animations, a soccer one, and a
 * baseball one. get creative and fun with them, like a corner kick for soccer then a breakaway etc."): the shared tiers
 * onto the four moves; the tuner values; the pure plan (the blow lands ONCE: the ball in the net; the keepy-uppies, the
 * corner, the cross, the one-two, the skills, the flick and the contact never touch the target); the geometry (the
 * corner on the target's goal line, the penalty spot, the run up the pitch with its defenders, the bicycle kick's spot
 * and apex, every point on screen even with the target tucked in a corner, the ball always landing on the target's
 * centre); the pure pose and ball; the variations; the slow mo; the goal and the net bulge; the runner (the portrait's
 * transform, opacity and z-order restored exactly on the end, finish, cancel and the safety timer; the ball, shadows,
 * goal, flag and defenders hidden; the camera applied once); the scene; the sounds; the cosmetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  HERO_SOCCER_CLIP_KEYS, HERO_SOCCER_DEFAULTS, HERO_SOCCER_RANGES, arcHeight, clampHeroSoccerValue, defenderAt, flagAt, goalAt, goalLayout,
  heroSoccerConfigJson, poseSegs, slowExtraMs, slowWindow, soccerBall, soccerCameraAt, soccerCues, soccerGeo, soccerKind, soccerPlan, soccerPose,
  soccerTimeScale, variantOf, type HeroSoccerNumKey, type SoccerVariant,
} from './heroSoccerConfig';
import { HeroSoccerScene, MAX_SOCCER_SPRITES, type HeroSoccerTextures } from './heroSoccerScene';
import { playHeroSoccer, type HeroSoccerOptions } from './heroSoccer';
import { SPEC } from '../HeroSoccerTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroSoccerTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  ball: W, shadow: W, goal: W, net: W, flag: W, defender: W, confetti: W, wordGoal: W, wordGolazo: W, wordNutmeg: W, wordOle: W,
};
const C = HERO_SOCCER_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean; variant?: SoccerVariant } = {}) => soccerPlan({ total, leadIn: leadInOf([total], o.reduced), ...o }, C);
const A = { x: 960, y: 900 }, D = { x: 960, y: 200 };
const R = 80;
const FRAME = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
const ctx = (total: number, v: SoccerVariant = 1, a = A, d = D, frame = FRAME) => {
  const p = plan(total, { variant: v });
  const g = soccerGeo(a, d, R, R, frame, C, v);
  const segs = poseSegs(p, g, C, a, R);
  return { p, g, segs, c: C, a, aR: R, frame };
};
const dist = (p: { x: number; y: number }, q: { x: number; y: number }): number => Math.hypot(p.x - q.x, p.y - q.y);
const inFrame = (p: { x: number; y: number }, f = FRAME, m = 0) => p.x >= f.x0 + m - 0.01 && p.x <= f.x1 - m + 0.01 && p.y >= f.y0 + m - 0.01 && p.y <= f.y1 - m + 0.01;
const VARIANTS: SoccerVariant[] = [1, 2, 3];

describe('the tiers: the shared four onto the four moves', () => {
  it('uses the shared thresholds; I volley, II corner, III breakaway, IV bicycle kick; a knockout plays the bicycle kick', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).kind, `dmg ${d}`).toBe(soccerKind(tierOf(d)));
    expect([1, 2, 3, 4].map((t) => soccerKind(t as 1 | 2 | 3 | 4))).toEqual(['volley', 'corner', 'breakaway', 'bicycle']);
    expect(plan(2, { knockout: true })).toMatchObject({ tier: 4, kind: 'bicycle' });
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; buttons on top; a clip row per sound', () => {
    for (const [k, [min, max]] of Object.entries(HERO_SOCCER_RANGES)) {
      const v = C[k as HeroSoccerNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroSoccerValue('skyHeight', 99)).toBe(5);
    expect(clampHeroSoccerValue('colorBall', 'nope')).toBe(C.colorBall);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroSoccerConfigJson(C)).previewDamage).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    expect((SPEC.actions ?? []).map((a) => a.label).filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
    expect(DEV_HERO_ATTACK_CHOICES).toContain('soccer');
    for (const k of HERO_SOCCER_CLIP_KEYS) {
      expect(keys.has(k as never), k).toBe(true);
      expect(keys.has(k.replace('Clip', 'Gain') as never), k).toBe(true);
      expect(keys.has(k.replace('Clip', 'Rate') as never), k).toBe(true);
    }
  });

  it('the sounds: the owner clips for the whistle, the kick, the net, the crowd "Ooooh", the goal roar and the commentator GOLAZO!; every default clip exists', async () => {
    expect(C.sfxWhistleClip).toBe('fx/soccer-whistle');
    expect(C.sfxKickClip).toBe('fx/soccer-kick');
    expect(C.sfxNetClip).toBe('fx/soccer-net');
    expect(C.sfxOohClip).toBe('fx/soccer-crowd-ooh');
    expect(C.sfxRoarClip).toBe('fx/soccer-goal-roar');
    expect(C.sfxGolazoClip).toBe('fx/soccer-golazo');
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const k of HERO_SOCCER_CLIP_KEYS) {
      const id = C[k];
      const base = resolve(__dirname, '../audio', id);
      expect(existsSync(`${base}.mp3`) || existsSync(`${base}.wav`), `${k} = ${id}`).toBe(true);
    }
  });
});

describe('the plan', () => {
  it('every tier and variation: exactly one impact cue (the ball in the net), a whistle first, the strike before it, the end last', () => {
    for (const total of [3, 8, 14, 40]) {
      for (const v of VARIANTS) {
        const p = plan(total, { variant: v });
        const cues = soccerCues(p);
        expect(cues.filter((q) => q.kind === 'impact'), `${total} v${v}`).toHaveLength(1);
        expect(cues[0]!.kind).toBe('charge');
        expect(cues[cues.length - 1]!.kind).toBe('end');
        expect(p.strikeAt, `${total} v${v}`).toBeLessThan(p.impactAt);
        expect(p.impactAt).toBeLessThanOrEqual(p.endAt);
        for (let i = 1; i < cues.length; i++) expect(cues[i]!.at).toBeGreaterThanOrEqual(cues[i - 1]!.at);
      }
    }
  });

  it('I THE VOLLEY: keepy-uppies where it stands, a higher flick, the hop and the volley, then the goal', () => {
    const p = plan(3);
    expect(p.kind).toBe('volley');
    expect(p.touches).toHaveLength(C.t1Touches);
    expect(p.flickAt!).toBeGreaterThan(p.touches[p.touches.length - 1]!);
    expect(p.takeoffAt).toBeLessThan(p.strikeAt);
    expect(p.impactAt - p.strikeAt).toBe(C.t1FlightMs);
    expect(p.homeEnd).toBe(p.homeAt); // it never leaves its slot
  });

  it('II THE CORNER: the jog to the flag, the set, the run-up, the kick; the header meets the cross before the goal; the one-two comes back before the curler', () => {
    const p1 = plan(8, { variant: 1 }), p2 = plan(8, { variant: 2 }), p3 = plan(8, { variant: 3 });
    for (const p of [p1, p2, p3]) {
      expect(p.kind).toBe('corner');
      expect(p.approachEnd - p.startAt).toBe(C.t2ApproachMs);
      expect(p.setAt!).toBeGreaterThanOrEqual(p.approachEnd);
      expect(p.runUpAt!).toBeGreaterThan(p.setAt!);
      expect(p.homeEnd).toBeGreaterThan(p.homeAt);
    }
    expect(p1.headAt).toBeNull();
    expect(p2.headAt!).toBeGreaterThan(p2.strikeAt);
    expect(p2.headAt!).toBeLessThan(p2.impactAt);
    expect(soccerCues(p2).some((q) => q.kind === 'head')).toBe(true);
    expect(p3.passOutAt!).toBeLessThan(p3.returnAt!);
    expect(p3.returnAt!).toBeLessThan(p3.strikeAt);
  });

  it('III THE BREAKAWAY: the run with its touches, a beat at each defender in order, the last touch and the finish', () => {
    const p = plan(14);
    expect(p.kind).toBe('breakaway');
    expect(p.beats).toHaveLength(C.defenders);
    for (const b of p.beats) { expect(b).toBeGreaterThan(p.startAt); expect(b).toBeLessThan(p.approachEnd); }
    expect(p.touches).toHaveLength(C.t3Touches);
    expect(p.strikeAt).toBeGreaterThanOrEqual(p.approachEnd);
  });

  it('IV THE BICYCLE KICK: the flick sky high, the sprint, the crouch, the leap; the kick at the top of the leap; the landing, the knee slide, home', () => {
    const p = plan(40);
    expect(p.kind).toBe('bicycle');
    expect(p.flickAt!).toBeLessThan(p.approachAt);
    expect(p.approachEnd).toBeLessThanOrEqual(p.gatherAt);
    expect(p.takeoffAt).toBeGreaterThan(p.gatherAt);
    expect(p.strikeAt).toBeCloseTo(p.takeoffAt + C.t4LeapMs / 2, 5);
    expect(p.landAt).toBeGreaterThan(p.strikeAt);
    expect(p.slideAt!).toBeGreaterThanOrEqual(Math.max(p.landAt, p.impactAt));
    expect(p.homeAt).toBeGreaterThan(p.slideEnd!);
  });

  it('reduced motion: the portrait never moves, no ball; the blow lands at the end of the formation', () => {
    const p = plan(40, { reduced: true });
    expect(p.reduced).toBe(true);
    const g = soccerGeo(A, D, R, R, FRAME, C);
    expect(poseSegs(p, g, C, A, R)).toEqual([]);
    expect(soccerBall({ p, g, segs: [], c: C, a: A, aR: R, frame: FRAME }, p.impactAt).visible).toBe(false);
    expect(soccerCues(p).map((q) => q.kind)).toEqual(['impact', 'end']);
  });
});

describe('the geometry', () => {
  it('the corner sits on the target\'s goal line at the side with more room; the flag beside it; the penalty spot in front of the goal', () => {
    const g = soccerGeo({ x: 700, y: 900 }, { x: 1300, y: 200 }, R, R, FRAME, C);
    expect(g.cornerSide).toBe(-1); // more room to the left of the target
    expect(g.corner.y).toBeLessThan(200); // on the target's goal line (the top)
    expect(g.corner.x).toBeLessThan(200);
    expect(dist(g.flag, g.corner)).toBeLessThan(R * 1.2);
    expect(g.header.y).toBeGreaterThan(200); // out in front of the goal (toward the pitch)
    expect(dist(g.header, g.hit)).toBeGreaterThan(R * 2);
    // A foe striking DOWN: the corner is on the bottom goal line.
    const f = soccerGeo({ x: 960, y: 200 }, { x: 960, y: 900 }, R, R, FRAME, C);
    expect(f.corner.y).toBeGreaterThan(900);
  });

  it('a target tucked in the top-right corner: every point on screen, and every shot still lands on its centre', () => {
    const a = { x: 700, y: 900 }, d = { x: 1830, y: 90 };
    for (const total of [3, 8, 14, 40]) {
      for (const v of VARIANTS) {
        const x = ctx(total, v, a, d);
        const { g, p } = x;
        for (const q of [g.corner, g.setBack, g.header, g.meet, g.shot, g.spot, g.contact, g.apex, g.slide, ...g.defenders.map((e) => e.at)]) expect(inFrame(q), `${total} v${v} ${JSON.stringify(q)}`).toBe(true);
        expect(g.hit).toEqual(d);
        // The ball is ON the target's centre the moment it hits the net.
        const b = soccerBall(x, p.impactAt - 0.001);
        expect(dist(b, d), `${total} v${v}`).toBeLessThan(R * 0.35);
        // The portrait stays on screen throughout.
        for (let t = p.chargeAt; t < p.endAt; t += 20) {
          const q = soccerPose(p, x.segs, C, t);
          expect(inFrame({ x: a.x + q.x, y: a.y + q.y }, FRAME, -R * 0.2), `${total} v${v} @${t}`).toBe(true);
        }
      }
    }
  });

  it('the arc is trimmed so the ball stays on screen', () => {
    const h = arcHeight({ x: 900, y: 120 }, { x: 1200, y: 100 }, 1, FRAME, 20);
    expect(100 - h).toBeGreaterThanOrEqual(-1);
  });
});

describe('the pose and the ball', () => {
  it('I: juggled up off the feet and back, in the air at the volley, then the ball flies at the goal', () => {
    const x = ctx(3);
    const { p } = x;
    const t0 = p.touches[0]!;
    const low = soccerBall(x, t0 + 2), high = soccerBall(x, t0 + p.touchMs / 2);
    expect(high.y).toBeLessThan(low.y - R * 0.5);
    expect(soccerPose(p, x.segs, C, p.strikeAt).air).toBeGreaterThan(0.5);
    expect(soccerBall(x, (p.strikeAt + p.impactAt) / 2).flying).toBe(true);
  });

  it('II: the portrait jogs to the corner; the Olimpico BENDS (it leaves the straight line); the header leaps to the ball; the one-two goes off screen and back', () => {
    const x1 = ctx(8, 1);
    const at = soccerPose(x1.p, x1.segs, C, x1.p.approachEnd + 1);
    expect(dist({ x: A.x + at.x, y: A.y + at.y }, x1.g.corner)).toBeLessThan(2);
    const mid = soccerBall(x1, (x1.p.strikeAt + x1.p.impactAt) / 2);
    const from = soccerBall(x1, x1.p.strikeAt + 1);
    // Distance of the mid-flight ball from the straight line corner -> goal.
    const dx = D.x - from.x, dy = D.y - from.y, l = Math.hypot(dx, dy);
    const off = Math.abs((mid.x - from.x) * dy - (mid.y - from.y) * dx) / l;
    expect(off).toBeGreaterThan(R * 0.5);
    const x2 = ctx(8, 2);
    expect(soccerPose(x2.p, x2.segs, C, x2.p.headAt!).air).toBeGreaterThan(0.5);
    const hb = soccerBall(x2, x2.p.headAt! - 0.5);
    const hp = soccerPose(x2.p, x2.segs, C, x2.p.headAt!);
    expect(dist(hb, { x: A.x + hp.x, y: A.y + hp.y })).toBeLessThan(R * 1.2);
    const x3 = ctx(8, 3);
    const out = soccerBall(x3, x3.p.passOutAt! + C.oneTwoMs - 1);
    expect(inFrame(out)).toBe(false); // off the edge of the screen
    expect(inFrame(soccerBall(x3, x3.p.returnAt! - 1))).toBe(true);
  });

  it('III: the portrait goes ROUND each defender (not through it); the nutmeg rolls the ball straight through it; the rainbow lifts it over', () => {
    for (const v of VARIANTS) {
      const x = ctx(14, v);
      const { p, g } = x;
      g.defenders.forEach((d, i) => {
        const q = soccerPose(p, x.segs, C, p.beats[i]!);
        expect(dist({ x: A.x + q.x, y: A.y + q.y }, d.at), `v${v} portrait at defender ${i}`).toBeGreaterThan(R * 0.9);
        const b = soccerBall(x, p.beats[i]!);
        if (v === 2) expect(dist(b, d.at), `nutmeg ${i}`).toBeLessThan(R * 1.05);
        if (v === 3) expect(b.air, `rainbow ${i}`).toBeGreaterThan(0.6);
      });
      // The defenders are drawn during the run, lunge, and are gone by the end.
      const d0 = defenderAt(p, g, 0, R, p.beats[0]! - 300), d1 = defenderAt(p, g, 0, R, p.beats[0]!);
      expect(d0.visible).toBe(true);
      expect(dist(d0, d1)).toBeGreaterThan(R * 0.2);
      expect(defenderAt(p, g, 0, R, p.endAt - 1).alpha).toBeLessThan(0.01);
    }
    const p1 = plan(8);
    expect(defenderAt(p1, soccerGeo(A, D, R, R, FRAME, C), 0, R, p1.startAt + 200).visible).toBe(false); // III only
  });

  it('IV: the ball goes sky high (bigger, higher than the portrait), comes down onto the contact, the flip is upside down at the kick, and the thunderbolt burns', () => {
    const x = ctx(40);
    const { p, g } = x;
    const up = soccerBall(x, (p.flickAt! + p.strikeAt) / 2);
    expect(up.scale).toBeGreaterThan(1.6);
    expect(up.y).toBeLessThan(g.contact.y);
    expect(dist(soccerBall(x, p.strikeAt - 0.5), g.contact)).toBeLessThan(R * 0.2);
    const q = soccerPose(p, x.segs, C, p.strikeAt);
    expect(Math.abs(Math.abs(q.rot) - 180)).toBeLessThan(1);
    expect(q.air).toBeGreaterThan(0.9);
    expect(soccerBall(x, (p.strikeAt + p.impactAt) / 2).fire).toBe(1);
    // Upright again (a full turn) on the landing.
    const l = soccerPose(p, x.segs, C, p.landAt + 1);
    expect(Math.abs(l.rot % 360)).toBeLessThan(1);
  });

  it('the goal shows before the shot lands, bulges on the impact and springs back; the flag is II\'s only; the camera pushes in on IV', () => {
    for (const total of [3, 8, 14, 40]) {
      const p = plan(total);
      expect(goalAt(p, p.impactAt - 10).alpha, `${total}`).toBeGreaterThan(0.9);
      expect(goalAt(p, p.impactAt - 10).bulge).toBe(0);
      expect(goalAt(p, p.impactAt + 20).bulge).toBeGreaterThan(0.5 * p.bulge);
      expect(goalAt(p, p.impactAt + 2000).bulge).toBeLessThan(0.02);
      expect(goalAt(p, p.endAt + 600).alpha).toBe(0);
    }
    expect(plan(40).bulge).toBeGreaterThan(plan(3).bulge * 2);
    expect(flagAt(plan(8), plan(8).strikeAt).alpha).toBeGreaterThan(0.9);
    expect(flagAt(plan(14), plan(14).strikeAt).alpha).toBe(0);
    const p4 = plan(40);
    expect(soccerCameraAt(p4, C, (p4.takeoffAt + p4.impactAt) / 2, { x: 0, y: -1 }).zoom).toBeGreaterThan(1);
    const l = goalLayout(D, R, 1);
    expect(l.center).toEqual(D);
    expect(l.right - l.left).toBeCloseTo(l.w, 6);
  });
});

describe('variety (II rolls a corner, III a skill; rolled per blow)', () => {
  it('the roll is stable per seed, covers all three, and the DEV override forces one', () => {
    const seen = new Set<number>();
    for (let s = 0; s < 60; s++) { expect(variantOf(s, C)).toBe(variantOf(s, C)); seen.add(variantOf(s, C)); }
    expect([...seen].sort()).toEqual([1, 2, 3]);
    for (const v of ['1', '2', '3']) expect(variantOf(7, { ...C, variation: v })).toBe(Number(v));
  });
});

describe('slow mo (III on the last touch, IV on the bicycle kick; a smooth ramp, never a freeze)', () => {
  it('III slows around the finish and IV around the contact, then IV runs a touch fast as the thunderbolt flies; never 0; I and II never slow', () => {
    const p3 = plan(14), p4 = plan(40);
    expect(soccerTimeScale(p3, C, p3.strikeAt)).toBeCloseTo(C.breakSlow, 2);
    expect(soccerTimeScale(p4, C, p4.strikeAt)).toBeCloseTo(C.bikeSlow, 2);
    const w = slowWindow(p4, C)!;
    expect(Math.max(...Array.from({ length: 40 }, (_, i) => soccerTimeScale(p4, C, w.b + (p4.impactAt - w.b) * (i / 40))))).toBeGreaterThan(1.05);
    for (const p of [plan(3), plan(8), p3, p4]) {
      let prev = soccerTimeScale(p, C, 0);
      for (let t = 0; t < p.endAt; t += 2) {
        const k = soccerTimeScale(p, C, t);
        expect(k).toBeGreaterThan(0.05);
        expect(Math.abs(k - prev)).toBeLessThan(0.08);
        prev = k;
      }
    }
    expect(slowWindow(plan(3), C)).toBeNull();
    expect(slowWindow(plan(8), C)).toBeNull();
    expect(slowExtraMs(p4, C)).toBeGreaterThan(200);
  });
});

function manualFrames(): { frames: HeroSoccerOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
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

function run(over: Partial<HeroSoccerOptions> = {}) {
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
  const h = playHeroSoccer({
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

  it('IV: the flick, the sprint and the contact never land it; the blow lands ONCE in the net; the portrait moved, raised, and is put back EXACTLY at the end', () => {
    const r = run({ total: 40, formation: formationOf([40], 40) });
    const { h, f, onImpact, onDone } = r;
    expect(r.host.querySelector('.hblast.hsoccer')).not.toBeNull();
    // The struck portrait does not react at all until the ball is in the net.
    for (let i = 0; i < 4000 && h.elapsed() < h.plan.impactAt - 8; i++) {
      f.tick(4, 4);
      if (h.elapsed() < h.plan.impactAt) expect(r.defenderEl.style.transform, `before the goal @${Math.round(h.elapsed())}`).toBe('');
    }
    expect(onImpact).not.toHaveBeenCalled();
    expect(document.body.classList.contains('duel-attacker-player')).toBe(true);
    expect(r.attackerEl.style.transform).toContain('translate(');
    expect(h.scene!.ownVisible).toBe(true);
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

  it('cancel() mid-run, finish() mid-corner and the safety timer each put the portrait back exactly (cancel never lands)', () => {
    const a = run({ total: 14, formation: formationOf([14], 14) });
    tickTo(a, a.h.plan.beats[0]!);
    expect(a.attackerEl.style.transform).toContain('translate(');
    a.h.cancel();
    expect(a.onImpact).not.toHaveBeenCalled();
    expectRestored(a);
    expect(a.f.hooked()).toBe(0);
    document.body.innerHTML = '';

    const b = run({ total: 8, formation: formationOf([8], 8), side: 'opp', attacker: { x: 960, y: 200 }, defender: { x: 960, y: 900 } });
    tickTo(b, b.h.plan.approachEnd + 30);
    expect(b.attackerEl.style.transform).toContain('translate(');
    b.h.finish();
    expect(b.onImpact).toHaveBeenCalledTimes(1);
    expectRestored(b, 'duel-attacker-opp');
    document.body.innerHTML = '';

    vi.useFakeTimers();
    try {
      const c = run({ total: 40, formation: formationOf([40], 40), safety: true });
      tickTo(c, c.h.plan.takeoffAt + 20);
      vi.advanceTimersByTime(c.h.plan.endAt + slowExtraMs(c.h.plan, C) + 3000);
      expect(c.onImpact).toHaveBeenCalledTimes(1);
      expect(c.h.done).toBe(true);
      expectRestored(c);
    } finally { vi.useRealTimers(); }
  });

  it('an unmount mid-attack (Recruit cancels the handle) leaves no transform, no class and no drawn ball behind, at every tier and variation', () => {
    for (const total of [3, 8, 14, 40]) {
      for (const v of ['1', '2', '3']) {
        const r = run({ total, formation: formationOf([total], total), cfg: { ...C, variation: v } });
        tickTo(r, (r.h.plan.strikeAt + r.h.plan.startAt) / 2);
        r.h.cancel();
        expectRestored(r);
        expect(r.f.hooked()).toBe(0);
        expect(r.root.children, `${total} v${v}`).toHaveLength(0);
        document.body.innerHTML = '';
      }
    }
  });

  it('both directions at every tier and variation, within the cap, the blow once; the camera applied once; a replay is identical; reduced motion', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        for (const v of ['1', '2', '3']) {
          const a = side === 'player' ? { x: 700, y: 900 } : { x: 1830, y: 90 };
          const d = side === 'player' ? { x: 1830, y: 90 } : { x: 700, y: 900 };
          const r = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total), cfg: { ...C, variation: v } });
          let peak = 0;
          for (let i = 0; i < 3000 && !r.h.done; i++) { r.f.tick(16, 16); peak = Math.max(peak, r.h.scene!.liveSprites); }
          expect(r.onImpact, `${side} ${total} v${v}`).toHaveBeenCalledTimes(1);
          expect(peak, `${side} ${total} v${v}`).toBeLessThanOrEqual(MAX_SOCCER_SPRITES);
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
    const x = run({ total: 40, formation: formationOf([40], 40), rollSeed: 77 });
    const y = run({ total: 40, formation: formationOf([40], 40), rollSeed: 77 });
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.geo).toEqual(y.h.geo);
    x.h.cancel(); y.h.cancel();
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expect(r.attackerEl.style.transform).toBe('translateX(3px)');
  });

  it('the same rollSeed rolls the same variation (a replay); the clock really slows on IV and still lands once', () => {
    for (let s = 0; s < 6; s++) {
      const x = run({ total: 14, formation: formationOf([14], 14), rollSeed: s });
      const y = run({ total: 14, formation: formationOf([14], 14), rollSeed: s });
      expect(x.h.variant).toBe(y.h.variant);
      expect(x.h.variant).toBe(variantOf(s, C));
      x.h.cancel(); y.h.cancel();
    }
    const r = run({ total: 40, formation: formationOf([40], 40) });
    let realMs = 0;
    for (let i = 0; i < 6000 && !r.h.done; i++) { r.f.tick(4, 4); realMs += 4; }
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expect(realMs).toBeGreaterThan(r.h.plan.endAt + slowExtraMs(r.h.plan, C) * 0.6);
  });
});

describe('the scene (headless Pixi)', () => {
  it('pools, stays under the cap, hides its own objects, drains, and destroy leaves nothing', () => {
    const scene = new HeroSoccerScene(TEX, {
      ball: 0xffffff, post: 0xffffff, net: 0xe6eeff, flag: 0xffd23f, defender: 0x2b3140, flash: 0xfff4dc, fire: 0xffb030, blast: 0xff7a1a, confettiA: 0x3fd17a, confettiB: 0xffd23f, side: 0xffcf5a,
    }, { ballSize: 0.42, shadowDrop: 0.5, goalSize: 1, wordSize: 1 }, R, R, 1, 9);
    scene.setBall({ visible: true, x: 10, y: 10, rot: 0, scale: 1, alpha: 1, air: 0.5, squash: 0.1, flying: true, fire: 1 });
    scene.setHeroShadow({ x: 0, y: 0 }, 0.6, 1);
    scene.setGoal(goalLayout(D, R, 1), 1, 0.3, 0.02, { x: 0, y: -1 });
    scene.setFlag({ x: 30, y: 30 }, 1, 0.1);
    scene.setDefender(0, { visible: true, x: 5, y: 5, rot: 0, scale: 1, alpha: 1 });
    expect(scene.ownVisible).toBe(true);
    for (let i = 0; i < 3; i++) {
      scene.touch(A, 1); scene.strike(A, 1.2); scene.skid(A, { x: 0, y: -1 }, 1.4); scene.speedLine(A, D, R); scene.launch(A, 2); scene.contact(A, { x: 0, y: -1 }, 2);
      scene.beaten(A, 'nutmeg'); scene.header(A); scene.slide(A, { x: 1, y: 0 });
      scene.goalHit(D, { x: 0, y: -1 }, { burst: 2, rings: 8, confetti: 80, big: true, blast: 3 });
      scene.trail({ visible: true, x: 5, y: 5, rot: 0, scale: 1, alpha: 1, air: 0.2, squash: 0, flying: true, fire: 1 });
      scene.trail({ visible: true, x: 5, y: 5, rot: 0, scale: 1, alpha: 1, air: 0.2, squash: 0, flying: true, fire: 0 });
    }
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_SOCCER_SPRITES);
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
  it('Golazo (attack_soccer) is a LEGENDARY crate hero attack that plays the soccer', () => {
    expect(COSMETIC_INDEX.attack_soccer).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: 'Golazo', assets: { style: 'soccer' }, active: true });
    expect(HERO_ATTACK_STYLES).toContain('soccer');
    expect(styleOfCosmetic('attack_soccer')).toBe('soccer');
  });
});
