// @vitest-environment jsdom
/**
 * THE FEL HERO ATTACK ("Chaos Bolt"; owner 2026-09-30: "a brand new attack animation that is on par with
 * hearthstone/modern world of warcraft", theme fel / chaos bolt): the tier mapping SHARED with every style; the ladder
 * (1 / 2 / 2 + the great bolt / 2 + the Hand); the tuner defaults + clamping; the pure plan (the rhythm, the one impact
 * beat, the Hand's order, reduced motion, determinism); the pure bolt paths (they form round the rim, clear of the face,
 * never above the frame, wind up AWAY from the target, and land on the struck portrait, the last on its heart) and the
 * meteor's fall (from above the frame onto the target); the camera; the runner on the shared clock (the consequence lands
 * exactly ONCE, on the last bolt or the eruption, never on a tick; both directions; slow motion; replay; finish / cancel;
 * cleanup); the headless scene (pooled, bounded, drains, destroy leaves nothing); and the cosmetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { fireTexturesFrom } from '../heroAttack/pixiFire';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  FEL_CAPS, HERO_FEL_DEFAULTS, HERO_FEL_RANGES, boltMotions, boltPose, clampHeroFelValue, felCameraAt, felCameraFocus, felCues,
  felMeteorMotion, felMeteorPose, felPlan, felSlots, felTravelMs, heroFelConfigJson, sanitizeHeroFelConfig,
  type HeroFelConfig, type HeroFelNumKey,
} from './heroFelConfig';
import { HeroFelScene, MAX_FEL_PARTICLES, MAX_FEL_SPRITES, type HeroFelTextures } from './heroFelScene';
import { felSeed, playHeroFel, type HeroFelOptions } from './heroFel';
import { SPEC } from '../HeroFelTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroFelTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  fire: fireTexturesFrom(W, W, W), scorch: W, shock: W, rune: W, crackle: W, shell: W, shard: W,
};
const C = HERO_FEL_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false) => felPlan({ total, distance, reduced, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { core: 0xf4ffe0, hot: 0xd2ff5a, fel: 0x5ef02c, deep: 0x1c9e2a, ember: 0x0b3a14, smoke: 0x1d1028, shell: 0x25082f, rune: 0x7dff3c, side: 0x8dff45 };
const LOOK = {
  kindle: 1, sigilSize: 1, motes: 1, boltFlame: 1, boltGlow: 0.85, shell: 1, crackle: 1, trail: 1, trailSmoke: 1, turbulence: 1, buoyancy: 1,
  smoke: 1, embers: 1, impactSize: 1, shards: 1, burnSize: 1, gateSize: 1.9, eruptMs: 560, eruptHeight: 1, burnoutMs: 900, ash: 1, scorch: 1,
};
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const R = 80;
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);

describe('the damage tiers (shared with every hero attack)', () => {
  it('Fel steps up on exactly the blows the other styles do: I 1-5, II 6-11, III 12-19, IV 20+; a knockout plays IV', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan([d], d).tier, `dmg ${d}`).toBe(sharedTierOf(d));
    expect(felPlan({ total: 3, distance: 1600, knockout: true }, C).tier).toBe(4);
  });

  it('the ladder ESCALATES: I ONE bolt, II TWO, III two then the GREAT bolt that burns the target, IV two then the HAND', () => {
    expect([P1, P2, P3, P4].map((p) => p.bolts.length)).toEqual([1, 2, 3, 2]);
    expect([P1, P2, P3, P4].map((p) => p.hand)).toEqual([false, false, false, true]);
    expect([P1, P2, P3, P4].map((p) => p.bolts.some((b) => b.great))).toEqual([false, false, true, false]);
    // the great bolt is the LAST, the biggest, and leaves last
    const g = P3.bolts[2]!;
    expect(g.great).toBe(true);
    expect(g.size).toBeGreaterThan(P3.bolts[0]!.size * 1.8);
    expect(g.launchAt).toBeGreaterThan(P3.bolts[1]!.launchAt);
    // it swells from the very start of the gather (anticipation while the others fly)
    expect(g.formAt).toBeLessThanOrEqual(P3.bolts[0]!.formAt);
    expect(P1.burn).toBe(0);
    expect(P2.burn).toBeGreaterThan(0);
    expect(P3.burn).toBeGreaterThan(P2.burn);
    for (const k of ['shakePx', 'embers', 'burst', 'dim'] as const) {
      expect(P2[k], k).toBeGreaterThan(P1[k]);
      expect(P3[k], k).toBeGreaterThan(P2[k]);
      expect(P4[k], k).toBeGreaterThan(P3[k]);
    }
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
    for (const k of ['colorCore', 'colorHot', 'colorFel', 'colorDeep', 'colorEmber', 'colorSmoke', 'colorShell', 'colorRune', 'colorPlayer', 'colorFoe'] as const) {
      expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroFelValue('t3Bolts', 99)).toBe(FEL_CAPS.bolts);
    expect(clampHeroFelValue('t1Bolts', 0)).toBe(1);
    expect(clampHeroFelValue('gateSize', -3)).toBe(0.8);
    expect(clampHeroFelValue('meteorMs', 99999)).toBe(2000);
    expect(clampHeroFelValue('eruptMs', Number.NaN)).toBe(C.eruptMs);
    expect(clampHeroFelValue('eruptMs', 'abc')).toBe(C.eruptMs);
    expect(clampHeroFelValue('eruptMs', '200')).toBe(200);
    expect(clampHeroFelValue('colorFel', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroFelValue('colorShell', 'purple')).toBe(C.colorShell);
    expect(clampHeroFelValue('sfxLaunchClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroFelValue('nope' as keyof HeroFelConfig, 1)).toBeUndefined();
    expect(clampHeroFelValue('toString' as keyof HeroFelConfig, 1)).toBeUndefined();
    const s = sanitizeHeroFelConfig({ t4Embers: 400, colorCore: 'x', bogus: 3 });
    expect(s.t4Embers).toBe(120);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroFelConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers Fel', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroFelConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Hand).toBe(1);
    const style = SPEC.controls.find((c) => c.key === 'attackStyle');
    expect(style?.options).toContain('fel');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('fel');
    expect(SPEC.buttonsOnTop).toBe(true);
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ You cast', '▶ Foe casts', '▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe small (3)', '▶ Foe tier II (8)',
      '▶ Foe medium (12)', '▶ Foe huge (40)']) {
      expect(labels).toContain(l);
    }
    expect(labels.filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
  });

  it('player-facing text has no em dash or "--" (owner rule 2026-09-21)', () => {
    expect(COSMETIC_INDEX.attack_fel!.name).not.toMatch(/—|--/);
  });
});

describe('the plan', () => {
  it('ticks then ONE impact: every bolt but the last is a tick; the last lands THE impact; only one impact beat', () => {
    for (const p of [P1, P2, P3]) {
      const cues = felCues(p);
      expect(cues.filter((q) => q.kind === 'impact')).toHaveLength(1);
      expect(cues.filter((q) => q.kind === 'hit')).toHaveLength(p.bolts.length - 1);
      expect(p.impactAt).toBe(Math.max(...p.bolts.map((b) => b.arriveAt)));
      for (const at of p.hits) expect(at).toBeLessThan(p.impactAt);
    }
  });

  it('Tier IV: both bolts tick, then the circle opens, the meteor falls, and it ERUPTS (the one impact)', () => {
    const cues = felCues(P4);
    const kinds = cues.map((q) => q.kind).filter((k) => k !== 'form');
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(2);
    expect(kinds.indexOf('gate')).toBeLessThan(kinds.indexOf('meteor'));
    expect(kinds.indexOf('meteor')).toBeLessThan(kinds.indexOf('impact'));
    expect(cues.filter((q) => q.kind === 'impact')).toHaveLength(1);
    expect(P4.gateAt).toBeGreaterThan(P4.fireAt);
    expect(P4.meteorAt - P4.gateAt).toBe(C.gateMs);
    for (const at of P4.hits) expect(at).toBeLessThan(P4.impactAt);
    expect(P4.booms.every((b) => b > P4.impactAt)).toBe(true);
  });

  it('brisk: Tier I lands within about a second of the formation; Tier IV within about 2.8 s', () => {
    expect(P1.impactAt - P1.chargeAt).toBeLessThan(1000);
    expect(P4.impactAt - P4.chargeAt).toBeLessThan(2800);
    expect(P4.endAt - P4.impactAt).toBeLessThan(1600);
  });

  it('reduced motion: no bolts at all, the blow lands on the formation end; the plan is deterministic', () => {
    const r = plan([6, 6, 6, 6, 6, 5, 5], 40, 1600, true);
    expect(r.reduced).toBe(true);
    expect(r.bolts).toEqual([]);
    expect(r.hand).toBe(false);
    expect(felCues(r).map((q) => q.kind)).toEqual(['impact', 'end']);
    expect(plan([3, 3, 2], 8)).toEqual(plan([3, 3, 2], 8));
  });

  it('the slots: II from either side, III the flankers first and the centre (the great bolt) last; travel scales gently', () => {
    expect(felSlots(1)).toEqual([0]);
    expect(felSlots(2)).toEqual([-1, 1]);
    expect(felSlots(3)).toEqual([-1, 1, 0]);
    expect(felTravelMs(1600, 300)).toBe(300);
    expect(felTravelMs(400, 300)).toBe(180);
    expect(felTravelMs(9000, 300)).toBe(345);
  });
});

describe('the paths', () => {
  it('bolts form round the striking rim (clear of the face, never above the frame), wind up AWAY from the target, and land on the struck portrait', () => {
    for (const p of [P1, P2, P3, P4]) {
      const ms = boltMotions(p, A, D, R, R, C, 1, 0);
      ms.forEach((m, i) => {
        const fromA = Math.hypot(m.home.x - A.x, m.home.y - A.y);
        expect(fromA).toBeGreaterThan(R * 1.1);
        expect(fromA).toBeLessThan(R * 2.4);
        expect(m.home.y - m.radius).toBeGreaterThanOrEqual(-1e-6);
        // the wind-up pulls it AWAY from the target
        expect(Math.hypot(m.from.x - D.x, m.from.y - D.y)).toBeGreaterThan(Math.hypot(m.home.x - D.x, m.home.y - D.y));
        expect(Math.hypot(m.to.x - D.x, m.to.y - D.y)).toBeLessThanOrEqual(R * 0.31);
        if (i === ms.length - 1) expect(m.to).toEqual(D); // THE impact lands on the struck hero's heart
        expect(boltPose(m, m.formAt - 1).grow).toBe(0);
        expect(boltPose(m, m.launchAt + 1).flying).toBe(true);
        expect(boltPose(m, m.arriveAt).landed).toBe(true);
      });
    }
  });

  it('the wind-up: just before the release the bolt is drawn back past its home; then it SNAPS (fast, still accelerating)', () => {
    const m = boltMotions(P1, A, D, R, R, C)[0]!;
    const back = boltPose(m, m.launchAt - 1);
    expect(Math.hypot(back.x - m.from.x, back.y - m.from.y)).toBeLessThan(4); // (the hover bob is 2 px)
    const span = m.arriveAt - m.launchAt;
    const at = (u: number) => boltPose(m, m.launchAt + span * u);
    const d1 = Math.hypot(at(0.2).x - at(0.1).x, at(0.2).y - at(0.1).y);
    const d2 = Math.hypot(at(0.9).x - at(0.8).x, at(0.9).y - at(0.8).y);
    expect(d2).toBeGreaterThan(d1);
  });

  it('the chaos meteor falls from ABOVE the frame onto the struck hero, accelerating', () => {
    const m = felMeteorMotion(P4, A, D, R, C, 0)!;
    expect(m.from.y).toBeLessThan(0);
    expect(m.to).toEqual(D);
    expect(m.startAt).toBe(P4.meteorAt);
    expect(m.contactAt).toBe(P4.impactAt);
    const a = felMeteorPose(m, m.startAt + 50), b = felMeteorPose(m, m.startAt + 100);
    const y = felMeteorPose(m, m.contactAt - 100), z = felMeteorPose(m, m.contactAt - 50);
    expect(Math.hypot(z.x - y.x, z.y - y.y)).toBeGreaterThan(Math.hypot(b.x - a.x, b.y - a.y));
    expect(felMeteorMotion(P3, A, D, R, C)).toBeNull();
  });
});

describe('the camera', () => {
  it('pushes in while the bolts gather, punches on the impact, rests by the end; Tier IV punches hardest and ends on the target', () => {
    expect(felCameraAt(P1, C, P1.fireAt).zoom).toBeGreaterThan(1);
    expect(felCameraAt(P1, C, P1.impactAt + 1).zoom).toBeGreaterThan(felCameraAt(P1, C, P1.fireAt).zoom);
    expect(felCameraAt(P1, C, P1.endAt + 600).zoom).toBeCloseTo(1, 2);
    expect(felCameraAt(P4, C, P4.impactAt + 1).zoom).toBeGreaterThan(felCameraAt(P3, C, P3.impactAt + 1).zoom);
    expect(felCameraFocus(P4, P4.chargeAt, A, D)).toEqual(A);
    expect(felCameraFocus(P4, P4.impactAt, A, D)).toEqual(D);
  });
});

/** A manual frame source: the test owns the clock. */
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

  it('Tier III lands the blow EXACTLY ONCE, on the GREAT bolt: never on a tick; the target BURNS; ends clean', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(h.plan.bolts).toHaveLength(3);
    expect(host.querySelector('.hblast.hfel')).not.toBeNull();
    f.tick(h.plan.fireAt - 20, 4);
    expect(h.scene!.liveBolts).toBe(3); // every bolt (the great one too) is forming before the first flies
    expect(h.scene!.charging).toBe(true);
    expect(h.scene!.liveFire).toBeGreaterThan(10);
    f.tick(h.plan.hits[h.plan.hits.length - 1]! - h.elapsed() + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt);
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('translate(');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(300, 8);
    expect(h.scene!.emitters).toBeGreaterThan(0); // the fel fire still burning on the struck rim
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(6000, 16);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('Tier IV: the bolts tick, the circle opens, the meteor falls, and the blow lands ONCE, on the ERUPTION', () => {
    const { h, f, onImpact, defenderEl } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.hand).toBe(true);
    expect(h.meteor).not.toBeNull();
    f.tick(h.plan.gateAt + 40, 4);
    expect(h.scene!.gateOpen).toBe(true);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.meteorAt - h.elapsed() + 40, 4);
    expect(h.scene!.meteorLive).toBe(true);
    expect(defenderEl.style.transform).toContain('translate('); // trembling in the circle (the clock runs on)
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.meteorLive).toBe(false);
    f.tick(200, 8);
    expect(h.scene!.liveFire).toBeGreaterThan(200); // the pillar, the nova and the dome
    expect(h.scene!.liveFire).toBeLessThanOrEqual(MAX_FEL_PARTICLES);
    f.tick(h.plan.endAt + 6000, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(f.hooked()).toBe(0);
  });

  it('works in both directions at every tier (the blow lands on whichever hero is struck); the pools stay in their caps', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 14, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peakS = 0;
        for (let t = 0; t < h.plan.impactAt + 800; t += 16) { f.tick(16, 16); peakS = Math.max(peakS, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peakS).toBeLessThanOrEqual(MAX_FEL_SPRITES);
        expect(h.scene!.pooledFire).toBeLessThanOrEqual(MAX_FEL_PARTICLES);
        expect(h.scene!.pooledSprites).toBeLessThanOrEqual(MAX_FEL_SPRITES);
        const last = h.motions[h.motions.length - 1]!;
        expect(last.to).toEqual(d);
        if (h.meteor) expect(h.meteor.to).toEqual(d);
        h.cancel();
      }
    }
  });

  it('the clock never pauses: every frame advances it by exactly the time played, through the eruption', () => {
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

  it('a replay plays the same: the same fight flies the same bolts and the same meteor and burns the same fire', () => {
    const a = run({ total: 40, formation: formationOf([40], 40) });
    const b = run({ total: 40, formation: formationOf([40], 40) });
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.motions).toEqual(b.h.motions);
    expect(a.h.meteor).toEqual(b.h.meteor);
    a.f.tick(a.h.plan.impactAt + 100, 16); b.f.tick(b.h.plan.impactAt + 100, 16);
    expect(a.h.scene!.liveFire).toBe(b.h.scene!.liveFire);
    expect(a.h.scene!.liveSprites).toBe(b.h.scene!.liveSprites);
    expect(felSeed(40, 1600, 'player')).toBe(felSeed(40, 1600, 'player'));
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
    b.f.tick(b.h.plan.meteorAt + 50);
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
    expect(h.motions).toEqual([]);
    expect(h.meteor).toBeNull();
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
    const s = new HeroFelScene(TEX, COLORS, LOOK, 1, 42);
    const ms = boltMotions(P4, A, D, R, R, C);
    const meteor = felMeteorMotion(P4, A, D, R, C, 0)!;
    let peakS = 0, peakF = 0;
    const cues = felCues(P4);
    let ci = 0;
    for (let t = 0; t < P4.endAt + 6000; t += 16) {
      while (ci < cues.length && cues[ci]!.at <= s.time) {
        const q = cues[ci++]!;
        const m = ms[q.i];
        if (q.kind === 'charge') s.startCharge(A.x, A.y, R, P4.fireAt - P4.chargeAt, ms.length);
        else if (q.kind === 'grow' && m) s.grow(m);
        else if (q.kind === 'fire' && m) s.fireBolt(m);
        else if (q.kind === 'hit' && m) { s.land(m); s.impact(m.to.x, m.to.y, R, { size: 1, big: false, dir: { x: 1, y: 0 }, flashAlpha: 0.85, embers: 10 }); }
        else if (q.kind === 'gate') s.openGate(D.x, D.y, R, P4.impactAt - P4.gateAt);
        else if (q.kind === 'meteor') s.startMeteor(meteor);
        else if (q.kind === 'impact') { s.erupt(D.x, D.y, R, { burst: 2, flashAlpha: 0.85, embers: 70, screen: 1920 }); s.burn(D.x, D.y, R, 1.3, 600); }
        else if (q.kind === 'boom') s.boom(D.x + 40, D.y, R, 1);
      }
      s.update(16);
      peakS = Math.max(peakS, s.liveSprites); peakF = Math.max(peakF, s.liveFire);
    }
    expect(peakF).toBeGreaterThan(300);
    expect(peakF).toBeLessThanOrEqual(MAX_FEL_PARTICLES);
    expect(peakS).toBeLessThanOrEqual(MAX_FEL_SPRITES);
    expect(s.update(16)).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.emitters).toBe(0);
    expect(s.gateOpen).toBe(false);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('clear() drops everything in flight at once; the pools are reused, not regrown', () => {
    const s = new HeroFelScene(TEX, COLORS, LOOK, 1, 9);
    const ms = boltMotions(P3, A, D, R, R, C);
    for (let t = 0; t < 600; t += 16) s.update(16);
    ms.forEach((m) => s.grow(m));
    s.openGate(D.x, D.y, R, 500);
    for (let t = 0; t < 300; t += 16) s.update(16);
    const pooledS = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.emitters).toBe(0);
    expect(s.update(16)).toBe(false);
    ms.forEach((m) => s.grow(m));
    s.openGate(D.x, D.y, R, 500);
    for (let t = 0; t < 300; t += 16) s.update(16);
    expect(s.pooledSprites).toBeLessThanOrEqual(pooledS + 8);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('Chaos Bolt (attack_fel) is a Legendary crate hero attack that plays Fel; the dev override can force it; the other attacks unchanged', () => {
    expect(COSMETIC_INDEX.attack_fel).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: 'Chaos Bolt', assets: { style: 'fel' }, active: true });
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
