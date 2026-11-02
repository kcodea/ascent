// @vitest-environment jsdom
/**
 * THE BASEBALL HERO ATTACK ("Charge the Mound", Legendary; owner 2026-11-02: "baseball - have the opponent be the pitcher
 * and the batter be the player dealing dmg. the final lvl 4/knockout should be the player getting struck by the ball and
 * charging the mound and beating up the opponent in an over the top fast attack sequence"): the shared tiers onto the
 * four plays; the tuner values and the sounds; the pure plan (the TARGET pitches first; the blow lands ONCE: the bonk,
 * the crater, the haymaker; the pitch, the crack, the hop, the bean on the striker and every brawl hit are ticks); the
 * geometry (every point on screen, the brawl cloud pulled in off the edges); the pure poses of BOTH portraits, the ball
 * and the bat; the runner (both portraits' transforms, the striker's opacity and the z-order restored exactly on the end,
 * finish, cancel and the safety timer; the ball, bat and shadows hidden; the camera applied once); the variation roll;
 * slow mo and the fast brawl; the scene; the cosmetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  FALL_LEAD_MS, HERO_BASEBALL_CLIP_KEYS, HERO_BASEBALL_DEFAULTS, HERO_BASEBALL_RANGES, baseballBall, baseballBat, baseballCameraAt, baseballCues, baseballGeo,
  baseballKind, baseballPlan, baseballTimeScale, batterPose, clampHeroBaseballValue, heroBaseballConfigJson, moonShadow, onScreen, pitcherPose,
  slowExtraMs, slowWindow, swingAngles, variantOf, type BaseballVariant, type HeroBaseballNumKey,
} from './heroBaseballConfig';
import { HeroBaseballScene, MAX_BASEBALL_SPRITES, type HeroBaseballTextures } from './heroBaseballScene';
import { playHeroBaseball, type HeroBaseballOptions } from './heroBaseball';
import { SPEC } from '../HeroBaseballTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroBaseballTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  ball: W, shadow: W, bat: W, puff: W, kapow: W, wordCrack: W, wordBonk: W, wordHomer: W, wordPow: W, wordBam: W, wordSmack: W, wordOut: W,
};
const C = HERO_BASEBALL_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean; variant?: BaseballVariant } = {}) => baseballPlan({ total, leadIn: leadInOf([total], o.reduced), ...o }, C);
const A = { x: 960, y: 900 }, D = { x: 960, y: 200 };
const R = 80;
const FRAME = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
const ctxOf = (total: number, o: { variant?: BaseballVariant } = {}, a = A, d = D) => {
  const p = plan(total, o);
  const g = baseballGeo(a, d, R, R, FRAME, C);
  return { p, g, c: C, d, dR: R, aR: R, a };
};
const dist = (p: { x: number; y: number }, q: { x: number; y: number }): number => Math.hypot(p.x - q.x, p.y - q.y);
const cueKinds = (total: number, o: { variant?: BaseballVariant } = {}) => baseballCues(plan(total, o)).map((q) => q.kind);

describe('the tiers: the shared four onto the four plays', () => {
  it('uses the shared thresholds; I up the middle, II the hot shot, III the moonshot, IV charge the mound; a knockout charges the mound', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).kind, `dmg ${d}`).toBe(baseballKind(tierOf(d)));
    expect([1, 2, 3, 4].map((t) => baseballKind(t as 1 | 2 | 3 | 4))).toEqual(['single', 'hotshot', 'moonshot', 'brawl']);
    expect(plan(2, { knockout: true })).toMatchObject({ tier: 4, kind: 'brawl' });
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; buttons on top; a clip row per sound', () => {
    for (const [k, [min, max]] of Object.entries(HERO_BASEBALL_RANGES)) {
      const v = C[k as HeroBaseballNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroBaseballValue('brawlHits', 99)).toBe(16);
    expect(clampHeroBaseballValue('colorBall', 'nope')).toBe(C.colorBall);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroBaseballConfigJson(C)).previewDamage).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    expect((SPEC.actions ?? []).map((a) => a.label).filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
    expect(DEV_HERO_ATTACK_CHOICES).toContain('baseball');
    for (const k of HERO_BASEBALL_CLIP_KEYS) {
      expect(keys.has(k as never), k).toBe(true);
      expect(keys.has(k.replace('Clip', 'Gain') as never), k).toBe(true);
      expect(keys.has(k.replace('Clip', 'Rate') as never), k).toBe(true);
    }
  });

  it('the sounds: a bat crack, a glove pop, a bonk, a slide whistle, the organ\'s "Charge!" and the umpire are their own clips; every default clip exists', async () => {
    expect(C.sfxCrackClip).toBe('fx/baseball-crack');
    expect(C.sfxGloveClip).toBe('fx/baseball-glove');
    expect(C.sfxBonkClip).toBe('fx/baseball-bonk');
    expect(C.sfxFallClip).toBe('fx/baseball-fall');
    expect(C.sfxChargeClip).toBe('fx/baseball-charge');
    expect(C.sfxUmpClip).toBe('fx/baseball-out');
    expect(C.sfxBrawlClip).toBe('fx/baseball-brawl');
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const k of HERO_BASEBALL_CLIP_KEYS) {
      const id = C[k];
      const base = resolve(__dirname, '../audio', id);
      expect(existsSync(`${base}.mp3`) || existsSync(`${base}.wav`), `${k} = ${id}`).toBe(true);
    }
  });
});

describe('the plan (the target pitches first; the blow lands once)', () => {
  it('I-III: glove pop, windup, the pitch, the swing, the CRACK, then the impact; the crack is before the impact', () => {
    for (const total of [3, 8, 14]) {
      const p = plan(total);
      expect(p.chargeAt).toBeLessThan(p.windAt);
      expect(p.windAt).toBeLessThan(p.releaseAt);
      expect(p.releaseAt).toBeLessThan(p.arriveAt);
      expect(p.swingAt).toBeLessThan(p.arriveAt);
      expect(p.swingEnd).toBeGreaterThan(p.arriveAt);
      expect(p.arriveAt).toBeLessThan(p.impactAt);
      expect(p.endAt).toBeGreaterThan(p.impactAt);
      const k = cueKinds(total);
      expect(k.indexOf('charge')).toBe(0);
      expect(k.indexOf('pitch')).toBeLessThan(k.indexOf('crack'));
      expect(k.indexOf('crack')).toBeLessThan(k.indexOf('impact'));
      expect(k).not.toContain('bean');
    }
  });

  it('II: the liner is fastest, the grounder hops once on the way, the foul tip takes the long way round', () => {
    const l = plan(8, { variant: 1 }), g = plan(8, { variant: 2 }), f = plan(8, { variant: 3 });
    expect(l.impactAt - l.arriveAt).toBeLessThan(g.impactAt - g.arriveAt);
    expect(g.hopAt).not.toBeNull();
    expect(g.hopAt!).toBeGreaterThan(g.arriveAt);
    expect(g.hopAt!).toBeLessThan(g.impactAt);
    expect(cueKinds(8, { variant: 2 })).toContain('hop');
    expect(cueKinds(8, { variant: 1 })).not.toContain('hop');
    expect(f.impactAt - f.arriveAt).toBeGreaterThan(g.impactAt - g.arriveAt);
  });

  it('III: up and gone (the twinkle), then down from the sky; the slide whistle bottoms out on the crash; the bat flip lands', () => {
    const p = plan(14);
    expect(p.arriveAt).toBeLessThan(p.apexAt!);
    expect(p.apexAt!).toBeLessThan(p.dropAt!);
    expect(p.dropAt!).toBeLessThan(p.impactAt);
    const cs = baseballCues(p);
    const fall = cs.find((q) => q.kind === 'fall')!;
    expect(fall.at).toBeGreaterThanOrEqual(p.apexAt!);
    expect(p.impactAt - fall.at).toBeLessThanOrEqual(FALL_LEAD_MS);
    expect(cs.map((q) => q.kind)).toEqual(expect.arrayContaining(['twinkle', 'batland']));
    expect(p.batLandAt!).toBeLessThan(p.endAt);
  });

  it('IV CHARGE THE MOUND: the bean, the bat slammed down, the fume, the charge, the collision, a flurry of hits inside the brawl, the haymaker = THE impact', () => {
    const p = plan(40);
    expect(p.kind).toBe('brawl');
    expect(p.beanAt).toBe(p.arriveAt);
    expect(p.beanAt!).toBeLessThan(p.batDropAt!);
    expect(p.batDropAt!).toBeLessThan(p.clatterAt!);
    expect(p.staggerEnd!).toBeLessThanOrEqual(p.chargeRunAt!);
    expect(p.chargeRunAt!).toBeLessThan(p.collideAt!);
    expect(p.hits.length).toBe(C.brawlHits);
    for (const h of p.hits) { expect(h).toBeGreaterThan(p.collideAt!); expect(h).toBeLessThan(p.brawlEnd!); }
    expect([...p.hits].sort((a, b) => a - b)).toEqual(p.hits);
    expect(p.koWindAt!).toBe(p.brawlEnd);
    expect(p.impactAt).toBeGreaterThan(p.brawlEnd!);
    const k = cueKinds(40);
    expect(k).toEqual(expect.arrayContaining(['bean', 'batdrop', 'clatter', 'fume', 'run', 'collide', 'hit', 'kowind']));
    expect(k).not.toContain('crack');
    expect(k.indexOf('bean')).toBeLessThan(k.indexOf('run'));
    expect(k.lastIndexOf('hit')).toBeLessThan(k.indexOf('impact'));
  });

  it('every tier: exactly one impact cue, the glove pop first, the end last', () => {
    for (const total of [3, 8, 14, 40]) {
      for (const variant of [1, 2, 3] as const) {
        const cs = baseballCues(plan(total, { variant }));
        expect(cs.filter((q) => q.kind === 'impact')).toHaveLength(1);
        expect(cs[0]!.kind).toBe('charge');
        expect(cs[cs.length - 1]!.kind).toBe('end');
        for (let i = 1; i < cs.length; i++) expect(cs[i]!.at).toBeGreaterThanOrEqual(cs[i - 1]!.at);
      }
    }
  });

  it('reduced motion: no pose, no ball, no bat; the blow lands at the end of the formation', () => {
    const p = plan(40, { reduced: true });
    expect(p.reduced).toBe(true);
    expect(baseballCues(p).map((q) => q.kind)).toEqual(['impact', 'end']);
    const x = { p, g: baseballGeo(A, D, R, R, FRAME, C), c: C, d: D, dR: R, aR: R, a: A };
    for (let t = 0; t < p.endAt; t += 50) {
      expect(baseballBall(x, t).visible).toBe(false);
      expect(baseballBat(x, t).visible).toBe(false);
      expect(batterPose(p, x.g, C, R, A, t)).toMatchObject({ x: 0, y: 0, rot: 0 });
      expect(pitcherPose(p, x.g, C, R, t)).toMatchObject({ x: 0, y: 0, rot: 0 });
    }
  });
});

describe('the geometry', () => {
  it('the bat meets the ball in front of the batter; the pitcher releases in front of itself; the foul tip goes wide to the hands\' side', () => {
    const g = baseballGeo(A, D, R, R, FRAME, C);
    expect(g.u).toEqual({ x: 0, y: -1 });
    expect(g.plate.y).toBeLessThan(A.y); // toward the pitcher
    expect(dist(g.plate, A)).toBeLessThan(R * 2.2);
    expect(g.release.y).toBeGreaterThan(D.y);
    // the foul tip loops out to the hands' side
    const side = (p: { x: number; y: number }) => (p.x - A.x) * g.n.x * g.side + (p.y - A.y) * g.n.y * g.side;
    expect(side(g.foul1)).toBeGreaterThan(R);
    // the swing: cocked behind, across the front at contact, through to the follow
    const s = swingAngles(g);
    expect(Math.abs(s.contact - s.cock)).toBeGreaterThan(1);
    expect(Math.abs(s.follow - s.contact)).toBeGreaterThan(1);
  });

  it('the foe tucked in the top-right corner (1920 x 1080 and 1600 x 900): the cloud, the brawl spots, the KO launch, the foul tip and the bat all on screen', () => {
    for (const fr of [FRAME, { x0: 0, y0: 0, x1: 1600, y1: 900 }]) {
      const a = { x: 140, y: fr.y1 - 160 }, d = { x: fr.x1 - 120, y: 110 };
      for (const [s, t] of [[a, d], [d, a]]) {
        const g = baseballGeo(s, t, R, R, fr, C);
        expect(onScreen(g.cloud, fr, R * 1.5), 'cloud').toBe(true);
        expect(onScreen(g.mound, fr, 0), 'mound').toBe(true);
        expect(onScreen({ x: t.x + g.pitcherBrawl.x, y: t.y + g.pitcherBrawl.y }, fr, 0), 'pitcher in the brawl').toBe(true);
        expect(onScreen({ x: t.x + g.launch.x, y: t.y + g.launch.y }, fr, R * 0.4), 'launch').toBe(true);
        expect(onScreen(g.foul1, fr, R * 0.5), 'foul1').toBe(true);
        expect(onScreen(g.foul2, fr, R * 0.5), 'foul2').toBe(true);
        expect(onScreen(g.batLand, fr, R * 0.3), 'bat').toBe(true);
        expect(onScreen(g.batSlam, fr, R * 0.3), 'bat slam').toBe(true);
      }
    }
  });
});

describe('the poses, the ball and the bat', () => {
  it('the PITCHER winds up and lunges before anything is hit; the BATTER loads and swings through the contact', () => {
    const x = ctxOf(3);
    const { p, g } = x;
    const mid = pitcherPose(p, g, C, R, p.windAt + (p.releaseAt - p.windAt) * 0.4);
    expect(Math.hypot(mid.x, mid.y)).toBeGreaterThan(1);
    expect(Math.abs(mid.rot)).toBeGreaterThan(1);
    const lunge = pitcherPose(p, g, C, R, p.releaseAt + 80);
    expect(lunge.x * g.u.x + lunge.y * g.u.y).toBeLessThan(0); // toward the batter
    expect(batterPose(p, g, C, R, A, p.swingAt - 10).rot).not.toBe(batterPose(p, g, C, R, A, p.swingEnd).rot);
    expect(batterPose(p, g, C, R, A, p.endAt - 1)).toMatchObject({ x: expect.closeTo(0, 0), y: expect.closeTo(0, 0) });
  });

  it('the ball: in the pitcher\'s hand, at the plate on the contact, on the pitcher on the impact, gone after', () => {
    for (const [total, variant] of [[3, 1], [8, 1], [8, 2], [8, 3]] as const) {
      const x = ctxOf(total, { variant });
      const { p, g } = x;
      const held = baseballBall(x, p.windAt + 40);
      expect(held.visible).toBe(true);
      expect(dist(held, D)).toBeLessThan(R * 1.6);
      expect(dist(baseballBall(x, p.arriveAt - 0.5), g.plate)).toBeLessThan(R * 0.2);
      expect(dist(baseballBall(x, p.impactAt - 0.5), g.hit)).toBeLessThan(R * 0.3);
      expect(baseballBall(x, p.impactAt + 1).visible).toBe(false);
    }
    // the grounder is on the ground (no lift) at the hop
    const gx = ctxOf(8, { variant: 2 });
    expect(baseballBall(gx, gx.p.hopAt!).lift).toBeLessThan(1);
  });

  it('III: the ball rockets up and away (shrinking), is gone at the top, and comes down GROWING onto the pitcher, its shadow growing under it', () => {
    const x = ctxOf(14);
    const { p } = x;
    const up = baseballBall(x, (p.arriveAt + p.apexAt!) / 2);
    expect(up.scale).toBeLessThan(1);
    expect(up.lift).toBeGreaterThan(R);
    expect(baseballBall(x, (p.apexAt! + p.dropAt!) / 2).visible).toBe(false);
    const a = baseballBall(x, p.dropAt! + 30), b = baseballBall(x, p.impactAt - 5);
    expect(b.scale).toBeGreaterThan(a.scale);
    expect(b.lift).toBeLessThan(a.lift);
    expect(moonShadow(p, p.impactAt - 5)).toBeGreaterThan(moonShadow(p, p.dropAt! + 30));
    expect(moonShadow(p, p.impactAt + 1)).toBe(0);
    // the bat flip leaves the hands
    const bat = baseballBat(x, (p.arriveAt + p.batLandAt!) / 2);
    expect(bat.lift).toBeGreaterThan(R * 0.3);
  });

  it('IV: the bean hits the BATTER (the ball ends on its face), the batter reels, charges to the mound, brawls, and both portraits go home', () => {
    const x = ctxOf(40);
    const { p, g } = x;
    expect(dist(baseballBall(x, p.beanAt! - 0.5), g.bean)).toBeLessThan(R * 0.2);
    expect(baseballBall(x, p.beanAt! + 1).visible).toBe(false);
    expect(Math.abs(batterPose(p, g, C, R, A, p.beanAt! + 60).rot)).toBeGreaterThan(1);
    const at = batterPose(p, g, C, R, A, p.collideAt! - 1);
    expect(dist({ x: A.x + at.x, y: A.y + at.y }, g.mound)).toBeLessThan(R * 0.2);
    // the pitcher is dragged into the cloud and shakes there; the batter too
    const pb = pitcherPose(p, g, C, R, (p.collideAt! + p.brawlEnd!) / 2);
    expect(dist({ x: D.x + pb.x, y: D.y + pb.y }, g.cloud)).toBeLessThan(R * 1.5);
    // the bat lies in the dirt through the brawl
    const bat = baseballBat(x, (p.collideAt! + p.brawlEnd!) / 2);
    expect(dist(bat, g.batSlam)).toBeLessThan(R * 0.5);
    // home at the end, both of them
    for (const q of [batterPose(p, g, C, R, A, p.endAt - 1), pitcherPose(p, g, C, R, p.endAt - 1)]) expect(Math.hypot(q.x, q.y)).toBeLessThan(2);
  });

  it('the camera pushes in and shakes on the impact; IV jolts on the bean and the brawl hits', () => {
    const p = plan(40);
    expect(baseballCameraAt(p, C, p.impactAt + 10, { x: 0, y: -1 }).zoom).toBeGreaterThan(1);
    const j = baseballCameraAt(p, C, p.hits[2]! + 20, { x: 0, y: -1 });
    expect(Math.hypot(j.x, j.y)).toBeGreaterThan(0);
    expect(baseballCameraAt(plan(40, { reduced: true }), C, 1000, { x: 0, y: 1 })).toEqual({ zoom: 1, x: 0, y: 0 });
  });
});

describe('variety (II rolls one of three hits)', () => {
  it('the roll is stable per seed, covers all three, and the DEV override forces one', () => {
    const seen = new Set<number>();
    for (let s = 0; s < 60; s++) { expect(variantOf(s, C)).toBe(variantOf(s, C)); seen.add(variantOf(s, C)); }
    expect([...seen].sort()).toEqual([1, 2, 3]);
    for (const v of ['1', '2', '3']) expect(variantOf(7, { ...C, variation: v })).toBe(Number(v));
  });
});

describe('slow mo (III on the contact, IV on the bean) and the FAST brawl', () => {
  it('III slows around the contact, IV around the bean and then runs fast through the brawl; never 0; I and II never slow', () => {
    for (const total of [3, 8]) { const p = plan(total); expect(slowWindow(p, C)).toBeNull(); for (let t = 0; t < p.endAt; t += 10) expect(baseballTimeScale(p, C, t)).toBe(1); }
    const three = plan(14);
    expect(baseballTimeScale(three, C, three.arriveAt)).toBeCloseTo(C.contactSlow, 5);
    const four = plan(40);
    expect(baseballTimeScale(four, C, four.beanAt!)).toBeLessThan(1);
    expect(baseballTimeScale(four, C, (four.collideAt! + four.brawlEnd!) / 2)).toBeCloseTo(C.brawlBoost, 5);
    for (const p of [three, four]) {
      let prev = baseballTimeScale(p, C, 0);
      for (let t = 0; t < p.endAt; t += 2) {
        const k = baseballTimeScale(p, C, t);
        expect(k).toBeGreaterThan(0.05);
        expect(Math.abs(k - prev)).toBeLessThan(0.05); // a smooth ramp
        prev = k;
      }
    }
    expect(slowExtraMs(three, C)).toBeGreaterThan(50);
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

/** Tick real frames until the attack's own clock reaches `t` (slow mo makes real time and attack time differ). */
function tickTo(r: { h: { elapsed(): number; done: boolean }; f: { tick: (ms: number, step?: number) => void } }, t: number, step = 4): void {
  for (let i = 0; i < 20000 && !r.h.done && r.h.elapsed() < t; i++) r.f.tick(step, step);
}

function run(over: Partial<HeroBaseballOptions> = {}) {
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
  camera.append(attackerEl, defenderEl);
  document.body.append(host, camera);
  const h = playHeroBaseball({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: { x: 960, y: 900 }, defender: { x: 960, y: 200 }, defenderRadius: R, attackerRadius: R,
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
  expect(r.camera.style.transform).toBe('');
  expect(document.body.classList.contains(zClass)).toBe(false);
  expect(r.host.querySelector('.hblast')).toBeNull();
  expect(r.h.scene?.ownVisible ?? false).toBe(false);
}

describe('the runner (the shared clock, both portraits restored on every exit)', () => {
  afterEach(() => { document.body.innerHTML = ''; document.body.className = ''; });

  it('IV: the bean, the collision and every brawl hit never land it; the blow lands ONCE on the haymaker; both portraits moved, raised, put back EXACTLY', () => {
    const r = run({ total: 40, formation: formationOf([40], 40) });
    const { h, onImpact, onDone } = r;
    expect(r.host.querySelector('.hblast.hbaseball')).not.toBeNull();
    tickTo(r, h.plan.windAt + 120);
    expect(r.defenderEl.style.transform).toContain('rotate('); // the pitcher winds up
    tickTo(r, h.plan.beanAt! + 30);
    expect(onImpact).not.toHaveBeenCalled(); // the bean is a tick
    expect(r.attackerEl.style.transform).toContain('rotate(');
    expect(document.body.classList.contains('duel-attacker-player')).toBe(true);
    tickTo(r, h.plan.hits[h.plan.hits.length - 1]! + 20);
    expect(onImpact).not.toHaveBeenCalled(); // every brawl hit is a tick
    expect(h.scene!.ownVisible).toBe(true); // the bat lies there
    tickTo(r, h.plan.impactAt - 12);
    expect(onImpact).not.toHaveBeenCalled();
    tickTo(r, h.plan.impactAt + 12);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(r.host.querySelector('.hblast-hit')!.textContent).toBe('-40');
    tickTo(r, h.plan.endAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
    r.f.tick(4000, 16);
    expect(r.f.hooked()).toBe(0);
    expect(r.root.children).toHaveLength(0);
  });

  it('cancel() mid-moonshot, finish() mid-pitch and the safety timer each put both portraits back exactly (cancel never lands)', () => {
    const a = run({ total: 14, formation: formationOf([14], 14) });
    tickTo(a, a.h.plan.apexAt! + 30);
    a.h.cancel();
    expect(a.onImpact).not.toHaveBeenCalled();
    expectRestored(a);
    expect(a.f.hooked()).toBe(0);
    document.body.innerHTML = '';

    const b = run({ total: 8, formation: formationOf([8], 8), side: 'opp', attacker: { x: 960, y: 200 }, defender: { x: 960, y: 900 } });
    tickTo(b, b.h.plan.releaseAt + 40);
    expect(b.defenderEl.style.transform).not.toBe('translateY(2px)');
    b.h.finish();
    expect(b.onImpact).toHaveBeenCalledTimes(1);
    expectRestored(b, 'duel-attacker-opp');
    document.body.innerHTML = '';

    vi.useFakeTimers();
    try {
      const c = run({ total: 40, formation: formationOf([40], 40), safety: true });
      tickTo(c, c.h.plan.collideAt! + 20);
      vi.advanceTimersByTime(c.h.plan.endAt + slowExtraMs(c.h.plan, C) + 3000);
      expect(c.onImpact).toHaveBeenCalledTimes(1);
      expect(c.h.done).toBe(true);
      expectRestored(c);
    } finally { vi.useRealTimers(); }
  });

  it('an unmount mid-attack (Recruit cancels the handle) leaves no transform, no class and nothing drawn, at every tier and hit', () => {
    for (const [total, v] of [[3, ''], [8, '1'], [8, '2'], [8, '3'], [14, ''], [40, '']] as const) {
      const r = run({ total, formation: formationOf([total], total), cfg: { ...C, variation: v } });
      tickTo(r, (r.h.plan.arriveAt + r.h.plan.impactAt) / 2);
      r.h.cancel();
      expectRestored(r);
      expect(r.f.hooked()).toBe(0);
      expect(r.root.children, `${total} ${v}`).toHaveLength(0);
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
        for (let i = 0; i < 3000 && !r.h.done; i++) { r.f.tick(16, 16); peak = Math.max(peak, r.h.scene!.liveSprites); }
        expect(r.onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak, `${side} ${total}`).toBeLessThanOrEqual(MAX_BASEBALL_SPRITES);
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
    x.h.cancel(); y.h.cancel();
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expect(r.attackerEl.style.transform).toBe('translateX(3px)');
    expect(r.defenderEl.style.transform).toBe('translateY(2px)');
  });

  it('the runner: the clock really slows on III\'s contact and runs fast in IV\'s brawl; the blow still lands once', () => {
    const r = run({ total: 14, formation: formationOf([14], 14) });
    tickTo(r, r.h.plan.arriveAt - 2);
    const t0 = r.h.elapsed();
    r.f.tick(40, 4);
    expect(r.h.elapsed() - t0).toBeLessThan(40 * 0.7);
    r.h.cancel();
    const b = run({ total: 40, formation: formationOf([40], 40) });
    tickTo(b, (b.h.plan.collideAt! + b.h.plan.brawlEnd!) / 2);
    const t1 = b.h.elapsed();
    b.f.tick(40, 4);
    expect(b.h.elapsed() - t1).toBeGreaterThan(40 * 1.15);
    tickTo(b, b.h.plan.endAt + 40);
    expect(b.onImpact).toHaveBeenCalledTimes(1);
  });
});

describe('the scene (headless Pixi)', () => {
  it('pools, stays under the cap, hides its own objects, drains, and destroy leaves nothing', () => {
    const scene = new HeroBaseballScene(TEX, { ball: 0xffffff, bat: 0xd79b5c, dust: 0xd9c3a0, flash: 0xfff4dc, pow: 0xffd23f, side: 0xffcf5a },
      { ballSize: 0.24, batLen: 120, shadowDrop: 0.5, wordSize: 1, frameH: 1080 }, R, R, 1, 9);
    scene.setBall({ visible: true, x: 10, y: 10, lift: 20, rot: 0, scale: 1, alpha: 1, flying: true });
    scene.setBat({ visible: true, x: 0, y: 0, lift: 0, rot: 1, alpha: 1 });
    scene.setTargetShadow(D, 0.5);
    expect(scene.ownVisible).toBe(true);
    for (let i = 0; i < 4; i++) {
      scene.glovePop(D); scene.kick(D, { x: 0, y: 1 }); scene.crack(A, { x: 0, y: -1 }, 1.6); scene.bonk(D, { x: 0, y: -1 }, 2, { rings: 8, word: 'bonk' });
      scene.hopDust(A); scene.twinkle(D); scene.crater(D, { x: 0, y: -1 }, 2, 6); scene.bean(A, { x: 0, y: 1 }); scene.fume(A); scene.clatter(A);
      scene.chargeDust(A, D, R); scene.cloudBurst(D, 2); scene.cloudPuff(D, 2); scene.benchRush(D, 1920, 2); scene.brawlHit(D, i, 1); scene.ko(D, D, { x: 0, y: -1 }, 2, 8);
      scene.popAway(D, { x: 1, y: 0 }); scene.trail({ visible: true, x: 5, y: 5, lift: 0, rot: 0, scale: 1, alpha: 1, flying: true });
    }
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_BASEBALL_SPRITES);
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
  it('Charge the Mound (attack_baseball) is a LEGENDARY crate hero attack that plays the baseball', () => {
    expect(COSMETIC_INDEX.attack_baseball).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: 'Charge the Mound', assets: { style: 'baseball' }, active: true });
    expect(HERO_ATTACK_STYLES).toContain('baseball');
    expect(styleOfCosmetic('attack_baseball')).toBe('baseball');
  });
});
