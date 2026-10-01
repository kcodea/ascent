// @vitest-environment jsdom
/**
 * THE EYE OF THE LEGION (style `fel`, cosmetic `attack_fel`; owner 2026-09-30: "extremely unique", the owner picked
 * the eye; round 1: "more and more open and blast the target until a massive fel explosion"): the tier mapping SHARED with
 * every style; the ladder (one eye, the pair, the pair and two more, the pair and a cascade of a dozen ending in the explosion); the tuner defaults + clamping; the pure plan (the one impact beat, II's tick, IV's
 * draw-in, reduced motion, determinism); the eye's pose (the rift, the cracking-then-snapping lids, the saccades, the
 * pupil slamming to a slit, the blink shut); the gaze (from the pupil, onto the struck portrait); the explosion's centre
 * (drawn in from an edge); the placement (on screen; IV never over the target); the camera; the runner on the shared clock (the
 * consequence lands exactly ONCE; both directions; slow motion; replay; finish / cancel; cleanup; the clock never
 * pauses); the headless scene (pooled, bounded, drains, destroy leaves nothing); and the cosmetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { fireTexturesFrom } from '../heroAttack/pixiFire';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  HERO_FEL_DEFAULTS, HERO_FEL_RANGES, MAX_EYES, almondPoints, cascadeTimes, explosionCentre, beamPose, clampHeroFelValue, eyeMotions, eyePose, felCameraAt, felCameraFocus,
  felCues, felPlan, felTravelMs, heroFelConfigJson, pupilPoint, sanitizeHeroFelConfig, type HeroFelConfig, type HeroFelNumKey,
} from './heroFelConfig';
import { HeroFelScene, MAX_FEL_PARTICLES, MAX_FEL_SPRITES, type HeroFelTextures } from './heroFelScene';
import { felSeed, playHeroFel, type HeroFelOptions } from './heroFel';
import { SPEC } from '../HeroFelTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroFelTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  fire: fireTexturesFrom(W, W, W), scorch: W, shock: W,
  sclera: W, veins: W, iris: W, pupil: W, lid: W, lidGlow: W, rift: W, riftRim: W, gaze: W, burst: W, veil: W, crackle: W, shard: W,
};
const C = HERO_FEL_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false) => felPlan({ total, distance, reduced, leadIn: leadInOf(values, reduced) }, C);
const COLORS = {
  sclera: 0xd6cf7e, vein: 0x9a1830, iris: 0x46d21e, fel: 0x6cf22e, hot: 0xd6ff5c, core: 0xf6ffe2, pupil: 0x06020a, lid: 0x170a1f, rift: 0x10051a, veil: 0x06160b,
};
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const R = 80;
const B = { w: 1920, h: 1080, margin: 10 };
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);

describe('the damage tiers (shared with every hero attack)', () => {
  it('steps up on exactly the blows the other styles do: I 1-5, II 6-11, III 12-19, IV 20+; a knockout plays IV', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan([d], d).tier, `dmg ${d}`).toBe(sharedTierOf(d));
    expect(felPlan({ total: 3, distance: 1600, knockout: true }, C).tier).toBe(4);
  });

  it('the ladder ESCALATES: one eye (a pulse), the pair (crossing), the pair and two more (a fel impact), a cascade of a dozen and more (the explosion)', () => {
    expect([P1, P2, P3, P4].map((p) => p.eyes.length)).toEqual([1, 2, 4, 14]);
    expect([P1, P2, P3, P4].map((p) => p.finale)).toEqual(['gaze', 'gaze', 'impact', 'explosion']);
    expect([P1, P2, P3, P4].map((p) => p.veil !== null)).toEqual([false, false, true, true]);
    for (const k of ['shakePx', 'burst', 'dim'] as const) {
      expect(P2[k], k).toBeGreaterThan(P1[k]);
      expect(P3[k], k).toBeGreaterThan(P2[k]);
      expect(P4[k], k).toBeGreaterThan(P3[k]);
    }
    expect(clampHeroFelValue('t4Eyes', 99)).toBe(MAX_EYES);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_FEL_RANGES)) {
      const v = C[k as HeroFelNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const [k, v] of Object.entries(C)) if (k.startsWith('color')) expect(v, k).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroFelValue('t4EyeSize', 99)).toBe(3);
    expect(clampHeroFelValue('slit', 0)).toBe(0.05);
    expect(clampHeroFelValue('t4BuildMs', 99999)).toBe(1600);
    expect(clampHeroFelValue('squint', Number.NaN)).toBe(C.squint);
    expect(clampHeroFelValue('squint', 'abc')).toBe(C.squint);
    expect(clampHeroFelValue('closeMs', '200')).toBe(200);
    expect(clampHeroFelValue('colorIris', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroFelValue('colorLid', 'purple')).toBe(C.colorLid);
    expect(clampHeroFelValue('sfxGazeClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroFelValue('nope' as keyof HeroFelConfig, 1)).toBeUndefined();
    expect(clampHeroFelValue('toString' as keyof HeroFelConfig, 1)).toBeUndefined();
    const s = sanitizeHeroFelConfig({ t4Veil: 4, colorCore: 'x', bogus: 3 });
    expect(s.t4Veil).toBe(0.9);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroFelConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers it; buttons on top', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroFelConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Veil).toBe(C.t4Veil);
    expect(SPEC.controls.find((c) => c.key === 'attackStyle')?.options).toContain('fel');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('fel');
    expect(SPEC.buttonsOnTop).toBe(true);
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ You cast', '▶ Foe casts', '▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe small (3)', '▶ Foe tier II (8)',
      '▶ Foe medium (12)', '▶ Foe huge (40)']) expect(labels).toContain(l);
    expect(labels.filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
  });
});

describe('the plan', () => {
  it('exactly ONE impact beat; II\'s first gaze is a tick before it; every eye opens before it fires and closes after', () => {
    for (const p of [P1, P2, P3, P4]) {
      const cues = felCues(p);
      expect(cues.filter((q) => q.kind === 'impact')).toHaveLength(1);
      for (const e of p.eyes) {
        expect(e.riftAt).toBeLessThan(e.openAt);
        expect(e.openAt).toBeLessThan(e.lockAt);
        expect(e.lockAt).toBeLessThan(e.fireAt);
        expect(e.fireAt).toBeLessThan(e.hitAt);
        expect(e.closeAt).toBeGreaterThanOrEqual(p.tier === 1 ? e.hitAt : p.impactAt);
        expect(e.goneAt).toBeLessThanOrEqual(p.endAt);
      }
    }
    expect(P2.hits).toHaveLength(1);
    expect(P2.hits[0]).toBeLessThan(P2.impactAt);
    expect(felCues(P2).filter((q) => q.kind === 'hit')).toHaveLength(1);
    // the two gazes are both ON at the impact (they cross on the target)
    const ms = eyeMotions(P2, A, D, R, R, B, C);
    for (const m of ms) expect(beamPose(m, P2.impactAt, C).on).toBe(true);
  });

  it('III / IV: the pair fires first, then the cascade tears open FASTER AND FASTER; every gaze is a tick; the blow lands after the last, once', () => {
    for (const p of [P3, P4]) {
      const pairFire = Math.max(p.eyes[0]!.fireAt, p.eyes[1]!.fireAt);
      const casc = p.eyes.slice(2);
      for (const e of casc) expect(e.riftAt).toBeGreaterThan(pairFire);
      expect(p.hits).toHaveLength(p.eyes.length);
      expect(p.landAt).toBe(Math.max(...p.eyes.map((e) => e.hitAt)));
      expect(p.impactAt).toBeGreaterThan(p.landAt);
      const kinds = felCues(p).map((q) => q.kind);
      expect(kinds.indexOf('land')).toBeLessThan(kinds.indexOf('impact'));
      // every eye snaps shut together, just after the blow
      expect(new Set(p.eyes.map((e) => e.closeAt)).size).toBe(1);
      expect(p.eyes[0]!.closeAt).toBeGreaterThan(p.impactAt);
      // every beam holds on the target up to the blow
      for (const m of eyeMotions(p, A, D, R, R, B, C)) expect(beamPose(m, p.impactAt - 1, C).on).toBe(true);
    }
    const gaps = P4.eyes.slice(2).map((e, i, a) => (i ? e.riftAt - a[i - 1]!.riftAt : 0)).slice(1);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeLessThanOrEqual(gaps[i - 1]!);
    expect(gaps[gaps.length - 1]!).toBeLessThan(gaps[0]!);
    expect(cascadeTimes(0, 4, 300, 0.5)).toEqual([0, 300, 450, 525]);
    expect(cascadeTimes(0, 3, 30, 0.5)).toEqual([0, 40, 80]); // a floor on the gap
  });

  it('brisk: Tier I lands within about 1.2 s of the formation; the Tier IV showpiece within about 4.5 s', () => {
    expect(P1.impactAt - P1.chargeAt).toBeLessThan(1200);
    expect(P4.impactAt - P4.chargeAt).toBeLessThan(4500);
    expect(P4.endAt - P4.impactAt).toBeLessThan(1800);
  });

  it('reduced motion: no eyes at all, the blow lands on the formation end; the plan is deterministic', () => {
    const r = plan([6, 6, 6, 6, 6, 5, 5], 40, 1600, true);
    expect(r.reduced).toBe(true);
    expect(r.eyes).toEqual([]);
    expect(felCues(r).map((q) => q.kind)).toEqual(['impact', 'end']);
    expect(plan([3, 3, 2], 8)).toEqual(plan([3, 3, 2], 8));
    expect(felTravelMs(1600, 300)).toBe(300);
  });
});

describe('the eye', () => {
  const m = eyeMotions(P2, A, D, R, R, B, C)[0]!;

  it('the rift tears first; the lids CRACK (slow) then SNAP open past 1 (overshoot); it narrows into a glare on the lock; it blinks shut; the rift seals', () => {
    expect(eyePose(m, m.riftAt - 1, C).rift).toBe(0);
    expect(eyePose(m, m.openAt - 1, C).open).toBe(0);
    expect(eyePose(m, m.openAt - 1, C).seam).toBeGreaterThan(0.5); // the glowing seam before the lids part
    const crack = eyePose(m, m.openAt + m.openMs * 0.3, C).open;
    expect(crack).toBeGreaterThan(0);
    expect(crack).toBeLessThan(0.2);
    let peak = 0;
    for (let t = m.openAt; t < m.openAt + m.openMs; t += 4) peak = Math.max(peak, eyePose(m, t, C).open);
    expect(peak).toBeGreaterThan(1);
    expect(eyePose(m, m.lockAt + 200, C).open).toBeLessThan(eyePose(m, m.lockAt - 1, C).open);
    expect(eyePose(m, m.closeAt + m.closeMs + 1, C).open).toBe(0);
    expect(eyePose(m, m.goneAt + 1, C).rift).toBeCloseTo(0, 5);
  });

  it('the pupil hunts (saccades away from the target), then FINDS the target and slams to a slit', () => {
    const before = eyePose(m, m.darts[0]! + 80, C);
    const locked = eyePose(m, m.lockAt + 128, C);
    expect(before.pupil).toBeGreaterThan(0.45);
    expect(locked.pupil).toBeCloseTo(C.slit, 1);
    // locked: the look points at the target
    const toT = { x: D.x - m.c.x, y: D.y - m.c.y };
    expect(Math.sign(locked.look.x)).toBe(Math.sign(toT.x));
    expect(Math.sign(locked.look.y)).toBe(Math.sign(toT.y));
    // before: it was looking somewhere else
    expect(Math.hypot(before.look.x - locked.look.x, before.look.y - locked.look.y)).toBeGreaterThan(0.3);
  });

  it('the gaze leaves the PUPIL and lands on the struck portrait; IV\'s explosion is drawn in from an edge, never cropped by a corner', () => {
    const at = m.hitAt + 10;
    const b = beamPose(m, at, C);
    expect(b.on).toBe(true);
    expect(b.to).toEqual(D);
    expect(b.head).toBe(1);
    expect(b.from).toEqual(pupilPoint(m, eyePose(m, at, C).look));
    expect(beamPose(m, m.fireAt - 1, C).on).toBe(false);
    const corner = explosionCentre({ x: 1840, y: 90 }, 100, B);
    expect(corner.x).toBeLessThan(1840);
    expect(corner.y).toBeGreaterThan(90);
    expect(Math.hypot(corner.x - 1840, corner.y - 90)).toBeLessThanOrEqual(100 * 1.3 * Math.SQRT2 + 1e-6);
    expect(explosionCentre({ x: 960, y: 540 }, 100, B)).toEqual({ x: 960, y: 540 });
  });

  it('every eye sits on screen, both directions, clear of both portraits (the cascade round the edges)', () => {
    for (const [a, d] of [[A, D], [D, A]] as const) {
      for (const p of [P1, P2, P3, P4]) {
        const ms = eyeMotions(p, a, d, R, R, B, C);
        expect(ms).toHaveLength(p.eyes.length);
        for (const e of ms) {
          const hh = e.a * 0.5;
          expect(e.c.x - e.a).toBeGreaterThanOrEqual(-1e-6);
          expect(e.c.x + e.a).toBeLessThanOrEqual(B.w + 1e-6);
          expect(e.c.y - hh).toBeGreaterThanOrEqual(-1e-6);
          expect(e.c.y + hh).toBeLessThanOrEqual(B.h + 1e-6);
        }
        for (const e of ms.slice(2)) expect(Math.hypot(e.c.x - d.x, e.c.y - d.y)).toBeGreaterThan(R * 1.9);
      }
    }
  });

  it('the almond is closed and symmetric', () => {
    const pts = almondPoints();
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(-128, 3);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(128, 3);
    expect(Math.min(...pts.map((p) => p.y))).toBeLessThan(-55);
    expect(Math.max(...pts.map((p) => p.y))).toBeGreaterThan(50);
  });
});

describe('the camera', () => {
  it('pushes in on the eye, punches on the impact, rests by the end; IV punches hardest; it ends on the target', () => {
    const e = P1.eyes[0]!;
    expect(felCameraAt(P1, C, e.lockAt).zoom).toBeGreaterThan(1);
    expect(felCameraAt(P1, C, P1.impactAt + 1).zoom).toBeGreaterThan(1);
    expect(felCameraAt(P1, C, P1.endAt + 600).zoom).toBeCloseTo(1, 2);
    expect(felCameraAt(P4, C, P4.impactAt + 1).zoom).toBeGreaterThan(felCameraAt(P3, C, P3.impactAt + 1).zoom);
    const eye = { x: 900, y: 200 };
    expect(felCameraFocus(P4, P4.chargeAt, eye, D)).toEqual(eye);
    expect(felCameraFocus(P4, P4.landAt, eye, D)).toEqual(D);
    // the shake ESCALATES: the rumble near the blow is bigger than early in the barrage
    const amp = (t: number) => { let mx = 0; for (let k = 0; k < 60; k += 2) { const q = felCameraAt(P4, C, t + k); mx = Math.max(mx, Math.hypot(q.x, q.y)); } return mx; };
    expect(amp(P4.impactAt - 80)).toBeGreaterThan(amp(P4.hits[0]! + 200));
    expect(amp(P4.impactAt + 10)).toBeGreaterThan(amp(P4.impactAt - 80));
  });
});

function manualFrames(): { frames: HeroFelOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroFelOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroFel({
    formation: formationOf([3, 2, 4], 9),
    total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, defenderRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl,
    ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('Tier II: the first gaze is a tick; the blow lands EXACTLY ONCE on the second; the eyes close and everything ends clean', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 8, formation: formationOf([8], 8) });
    expect(h.eyes).toHaveLength(2);
    expect(host.querySelector('.hblast.hfel')).not.toBeNull();
    f.tick(h.plan.eyes[0]!.lockAt + 20, 4);
    expect(h.scene!.eyesShowing).toBe(2);
    f.tick(h.plan.hits[0]! - h.elapsed() + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.beamsOn).toBeGreaterThan(0);
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.beamsOn).toBe(2); // the two gazes cross on the target
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('translate(');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-8');
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.eyesShowing).toBe(0);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(5000, 16);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('Tier IV: the veil falls, more and more eyes open and burn the target, the knot builds, and the blow lands ONCE on the EXPLOSION; the eyes shut together', () => {
    const { h, f, onImpact, defenderEl } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.finale).toBe('explosion');
    f.tick(h.plan.eyes[1]!.hitAt + 20, 4);
    expect(h.scene!.beamsOn).toBe(2);
    f.tick(h.plan.landAt - h.elapsed() + 30, 4);
    expect(h.scene!.beamsOn).toBe(14); // every eye burning on the target
    expect(h.scene!.veilAlpha).toBeGreaterThan(0.3);
    expect(h.scene!.pulling).toBe(true);
    expect(defenderEl.style.transform).toContain('scale('); // pinned and trembling (the clock runs on)
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.pulling).toBe(false);
    f.tick(100, 8);
    expect(h.scene!.liveFire).toBeGreaterThan(80); // the explosion's fel fire
    f.tick(h.plan.eyes[0]!.closeAt + h.plan.eyes[0]!.closeMs - h.elapsed() + 20, 4);
    expect(h.scene!.beamsOn).toBe(0);
    f.tick(h.plan.endAt + 5000, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.veilAlpha).toBe(0);
    expect(h.scene!.eyesShowing).toBe(0);
    expect(f.hooked()).toBe(0);
  });

  it('works in both directions at every tier; the pools stay in their caps', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 14, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.impactAt + 800; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_FEL_SPRITES);
        expect(h.scene!.pooledFire).toBeLessThanOrEqual(MAX_FEL_PARTICLES);
        for (const e of h.eyes) expect(e.target).toEqual(d);
        h.cancel();
      }
    }
  });

  it('the clock never pauses: every frame advances it by exactly the time played', () => {
    const { h, f } = run({ total: 40, formation: formationOf([40], 40) });
    let prev = h.elapsed();
    for (let t = 0; t < h.plan.endAt; t += 16) {
      f.tick(16, 16);
      if (h.done) break;
      expect(h.elapsed() - prev).toBeCloseTo(16, 6);
      prev = h.elapsed();
    }
  });

  it('slow motion stretches real time but the impact is still the same sequence beat', () => {
    const { h, f, onImpact } = run({ speed: 0.25 });
    f.tick(h.plan.impactAt * 4 - 40, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(60, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('a replay plays the same', () => {
    const a = run({ total: 40, formation: formationOf([40], 40) });
    const b = run({ total: 40, formation: formationOf([40], 40) });
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.eyes).toEqual(b.h.eyes);
    a.f.tick(a.h.plan.impactAt + 100, 16); b.f.tick(b.h.plan.impactAt + 100, 16);
    expect(a.h.scene!.liveFire).toBe(b.h.scene!.liveFire);
    expect(a.h.scene!.liveSprites).toBe(b.h.scene!.liveSprites);
    expect(felSeed(40, 1600, 'player')).not.toBe(felSeed(40, 1600, 'opp'));
    a.h.cancel(); b.h.cancel();
  });

  it('finish() before impact still lands the blow once and ends; cancel() never lands it and restores everything', () => {
    const a = run();
    a.f.tick(600);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    expect(a.onDone).toHaveBeenCalledTimes(1);
    expect(a.f.hooked()).toBe(0);
    expect(a.root.children).toHaveLength(0);
    const b = run({ total: 40, formation: formationOf([40], 40) });
    b.f.tick(b.h.plan.landAt + 50);
    b.h.cancel();
    b.f.tick(5000);
    expect(b.onImpact).not.toHaveBeenCalled();
    expect(b.onDone).not.toHaveBeenCalled();
    expect(b.host.querySelector('.hblast')).toBeNull();
    expect(b.camera.style.transform).toBe('');
    expect(b.attackerEl.style.transform).toBe('');
    expect(b.defenderEl.style.transform).toBe('');
    expect(b.root.children).toHaveLength(0);
  });

  it('reduced motion: no Pixi layer, no camera or portrait move, just fades; the blow lands once', () => {
    const { h, f, root, onImpact, camera, host, defenderEl, attackerEl } = run({ reduced: true, total: 40, formation: formationOf([40], 40) });
    expect(root.children).toHaveLength(0);
    expect(h.scene).toBeNull();
    expect(h.eyes).toEqual([]);
    f.tick(h.plan.impactAt + 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(camera.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(host.querySelector('.hblast-total-n')!.textContent).toBe('40');
    f.tick(h.plan.endAt);
    expect(f.hooked()).toBe(0);
  });

  it('the safety timer lands the blow if frames never come (a hidden tab)', () => {
    vi.useFakeTimers();
    try {
      const onImpact = vi.fn();
      const h = playHeroFel({
        formation: formationOf([25], 25), total: 25, attacker: { x: 0, y: 0 }, defender: { x: 800, y: 0 },
        cfg: C, reduced: false, onImpact, frames: () => () => {}, textures: TEX, sound: false,
        mount: () => () => {}, host: null, camera: null,
      });
      vi.advanceTimersByTime(h.plan.endAt + 2600);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(h.done).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe('the scene (headless Pixi)', () => {
  it('a whole Tier IV stays in the caps and drains; destroy leaves nothing', () => {
    const ms = eyeMotions(P4, A, D, R, R, B, C);
    const s = new HeroFelScene(TEX, COLORS, C, ms, 1, 42, { w: 1920, h: 1080 });
    s.setVeil(P4.veil);
    s.setTarget(D.x, D.y, R);
    let peakS = 0, peakF = 0;
    const cues = felCues(P4);
    let ci = 0;
    for (let t = 0; t < P4.endAt + 5000; t += 16) {
      while (ci < cues.length && cues[ci]!.at <= s.time) {
        const q = cues[ci++]!;
        if (q.kind === 'rift') s.rift(q.i);
        else if (q.kind === 'open') s.opened(q.i);
        else if (q.kind === 'lock') s.locked(q.i);
        else if (q.kind === 'fire') s.fired(q.i);
        else if (q.kind === 'land') s.drawIn(D.x, D.y, R, P4.impactAt - P4.landAt);
        else if (q.kind === 'impact') s.explosion(D.x, D.y, R, { burst: 2.4, flashAlpha: 0.85, screen: 1920, roomAbove: false });
        else if (q.kind === 'close') s.closed(q.i);
        else if (q.kind === 'seal') s.sealed(q.i);
      }
      s.update(16);
      peakS = Math.max(peakS, s.liveSprites); peakF = Math.max(peakF, s.liveFire);
    }
    expect(peakF).toBeGreaterThan(40);
    expect(peakF).toBeLessThanOrEqual(MAX_FEL_PARTICLES);
    expect(peakS).toBeLessThanOrEqual(MAX_FEL_SPRITES);
    expect(s.update(16)).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.emitters).toBe(0);
    expect(s.eyesShowing).toBe(0);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('the eye rig: the lids are a mask scaled in y; the pupil narrows to a slit on the lock; clear() drops everything', () => {
    const ms = eyeMotions(P1, A, D, R, R, B, C);
    const s = new HeroFelScene(TEX, COLORS, C, ms, 1, 9);
    const m = ms[0]!;
    const rig = s.eyeRigs[0]!;
    while (s.time < m.openAt + m.openMs * 0.3) s.update(16);
    expect(rig.root.visible).toBe(true);
    expect(rig.mask.scale.y).toBeGreaterThan(0);
    expect(rig.mask.scale.y).toBeLessThan(0.25);
    while (s.time < m.darts[0]! + 80) s.update(16);
    const wide = rig.pupil.scale.x;
    while (s.time < m.lockAt + 200) s.update(16);
    expect(rig.pupil.scale.x).toBeLessThan(wide * 0.5);
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.emitters).toBe(0);
    expect(s.update(16)).toBe(false);
    expect(s.eyesShowing).toBe(0);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('Eye of the Legion (attack_fel) is a Legendary crate hero attack that plays the fel style; the dev override can force it', () => {
    expect(COSMETIC_INDEX.attack_fel).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: 'Eye of the Legion', assets: { style: 'fel' }, active: true });
    expect(COSMETIC_INDEX.attack_fel!.name.length).toBeLessThanOrEqual(20);
    expect(COSMETIC_INDEX.attack_fel!.name).not.toMatch(/—|--/);
    expect(HERO_ATTACK_STYLES).toContain('fel');
    expect(styleOfCosmetic('attack_fel')).toBe('fel');
    for (const [id, style] of [['attack_fire', 'fire'], ['attack_basketball', 'basketball'], ['attack_blast', 'blast']] as const) {
      expect(styleOfCosmetic(id)).toBe(style);
    }
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_fel' })).toBe('fel');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'fel' })).toBe('fel');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_fel' })).toBe('classic');
  });
});
