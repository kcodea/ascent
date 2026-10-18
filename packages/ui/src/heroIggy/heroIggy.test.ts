// @vitest-environment jsdom
/**
 * THE IGGY BLAST HERO ATTACK (Legendary; owner 2026-10-18: "a dragon blast attack that has increasing magnitude, with
 * powerful back blasting/ward effects", concept A "Recoil Ward" picked: "go with A, legendary rarity, name Iggy Blast"):
 * the shared tiers (a knockout plays IV); the stage ladder (1 / 2 / 3 / 3 + the shatter); the pure plan (stages, ticks,
 * the hit-stop then the slam, the surge, the impact, reduced motion, determinism); the push and the ward (it flattens
 * harder each stage, holds through the hit-stop, slams outward); the camera (frozen in the hit-stop); the runner on the
 * shared clock (the consequence lands exactly ONCE, on the surge's detonation, never on a stage tick); the headless
 * scene (bounded, freezes for the hit-stop, drains, destroy leaves nothing); the cosmetic and the style mapping.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX, cosmeticOf } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { fireTexturesFrom } from '../heroAttack/pixiFire';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import { knockoutVariantFor } from '../heroAttack/knockoutVariant';
import {
  HERO_IGGY_DEFAULTS, IGGY_STAGE_LOOKS, clampHeroIggyValue, heroIggyConfigJson, iggyCameraAt, iggyCues, iggyPlan, iggyPushAt,
  iggyStream, iggyWardAt, sanitizeHeroIggyConfig, stageLook,
} from './heroIggyConfig';
import { HeroIggyScene, MAX_IGGY_PARTICLES, MAX_IGGY_SPRITES, MAX_WING_PARTICLES, type HeroIggyTextures } from './heroIggyScene';
import { playHeroIggy, type HeroIggyOptions } from './heroIggy';
import { SPEC } from '../HeroIggyTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroIggyTextures = { fire: fireTexturesFrom(W, W, W), glow: W, spark: W, shock: W, scorch: W, wardBody: W, wardRim: W, wardCells: W };
const C = HERO_IGGY_DEFAULTS;
const plan = (values: number[], total: number, o: { knockout?: boolean; reduced?: boolean } = {}) =>
  iggyPlan({ total, distance: 1600, reduced: o.reduced, knockout: o.knockout, leadIn: leadInOf(values, !!o.reduced) }, C);
const COLORS = { core: 0xf2fbff, hot: 0x9fe8ff, flame: 0x3fb4ff, deep: 0x1f5bff, ember: 0x0b1a5a, smoke: 0x1a2233, ward: 0x7fd8ff, wing: 0xd4142e, wingHot: 0xffe9e4, side: 0x5fd0ff };
const LOOK = {
  streamFlame: 1, streamSpeed: 1, turbulence: 1, buoyancy: 0.35, smoke: 0.5, embers: 1, wardAlpha: 0.55, wings: 1, eyes: 1, inhale: 1,
  sparks: 1, backBlast: 1, slamSize: 1, shards: 22, scorch: 1, explodeSize: 1,
};
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);

describe('the damage tiers (shared with every hero attack)', () => {
  it('Iggy steps up on exactly the shared thresholds: I 1-5, II 6-11, III 12-19, IV 20+', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan([d], d).tier, `dmg ${d}`).toBe(sharedTierOf(d));
  });

  it('a knockout always plays Tier IV (the shatter), whatever the number; Iggy has no Knockout variant (it is Legendary)', () => {
    const ko = plan([2, 1], 3, { knockout: true });
    expect(ko.tier).toBe(4);
    expect(ko.shatter).toBe(true);
    expect(knockoutVariantFor({ style: 'iggy', knockout: true, cosmeticId: 'attack_iggy_blast' })).toBe(false);
  });

  it('the magnitude INCREASES: I one stage, II two, III and IV all three; only IV shatters the ward', () => {
    expect([P1, P2, P3, P4].map((p) => p.stages.length)).toEqual([1, 2, 3, 3]);
    expect([P1, P2, P3, P4].map((p) => p.shatter)).toEqual([false, false, false, true]);
    for (const k of ['shakePx', 'zoom', 'recoilPx', 'flatten', 'width', 'embers'] as const) {
      expect(P2[k], k).toBeGreaterThan(P1[k]);
      expect(P3[k], k).toBeGreaterThan(P2[k]);
      expect(P4[k], k).toBeGreaterThan(P3[k]);
    }
    // Longer shows for bigger blows.
    const len = (p: typeof P1): number => p.endAt - p.chargeAt;
    expect(len(P2)).toBeGreaterThan(len(P1));
    expect(len(P3)).toBeGreaterThan(len(P2));
    expect(len(P4)).toBeGreaterThan(len(P3));
  });

  it('the stages climb thin blue -> cyan -> white-cored, and a tier\'s last stage is the hottest it reaches', () => {
    expect(IGGY_STAGE_LOOKS.map((l) => l.name)).toEqual(['thin blue', 'cyan', 'white-cored']);
    expect(stageLook(0, 1).name).toBe('thin blue');
    expect([stageLook(0, 2).name, stageLook(1, 2).name]).toEqual(['thin blue', 'cyan']);
    expect([0, 1, 2].map((i) => stageLook(i, 3).name)).toEqual(['thin blue', 'cyan', 'white-cored']);
    for (let i = 1; i < IGGY_STAGE_LOOKS.length; i++) {
      expect(IGGY_STAGE_LOOKS[i]!.heat).toBeGreaterThan(IGGY_STAGE_LOOKS[i - 1]!.heat);
      expect(IGGY_STAGE_LOOKS[i]!.width).toBeGreaterThan(IGGY_STAGE_LOOKS[i - 1]!.width);
    }
  });
});

describe('the pure plan', () => {
  it('beats in order: charge, breath, each stage and its tick, the PEAK (hit-stop), the SLAM, the impact; deterministic', () => {
    for (const p of [P1, P2, P3, P4]) {
      expect(p.chargeAt).toBeLessThan(p.breathAt);
      p.stages.forEach((s, i) => { if (i) expect(s.at).toBeGreaterThan(p.stages[i - 1]!.at); expect(s.hitAt).toBeGreaterThan(s.at); });
      expect(p.peakAt).toBeGreaterThan(p.stages[p.stages.length - 1]!.hitAt);
      expect(p.reboundAt).toBeGreaterThan(p.peakAt); // the hit-stop
      expect(p.impactAt).toBeGreaterThan(p.reboundAt);
      expect(p.endAt).toBeGreaterThan(p.impactAt);
      for (const h of p.hits) expect(h).toBeLessThan(p.impactAt);
    }
    expect(plan([6, 6, 6, 6, 6, 5, 5], 40)).toEqual(P4);
    const kinds = iggyCues(P3).map((q) => q.kind).filter((k) => k !== 'end');
    expect(kinds).toEqual(['charge', 'breath', 'hit', 'stage', 'hit', 'stage', 'hit', 'peak', 'rebound', 'impact']);
    expect(iggyCues(P4).filter((q) => q.kind === 'boom').length).toBe(2);
  });

  it('the hit-stop is tunable and 0 means none (the owner ruled hit-stop out on 2026-09-28; this is his call)', () => {
    const none = iggyPlan({ total: 40, distance: 1600, leadIn: 0 }, { ...C, hitStopMs: 0 });
    expect(none.reboundAt).toBe(none.peakAt);
    expect(P4.reboundAt - P4.peakAt).toBeGreaterThan(40);
    expect(P4.reboundAt - P4.peakAt).toBeLessThan(120);
  });

  it('reduced motion: no stages, no ward, no hit-stop; the blow lands where the formation ends', () => {
    const r = plan([3, 3, 3, 3, 2], 14, { reduced: true });
    expect(r.reduced).toBe(true);
    expect(r.stages).toEqual([]);
    expect(r.hits).toEqual([]);
    expect(r.shakePx).toBe(0);
    expect(iggyCues(r).map((q) => q.kind)).toEqual(['impact', 'end']);
  });
});

describe('the push, the ward and the camera (pure)', () => {
  it('the push steps up at each stage, holds through the hit-stop, and springs back through zero on the slam', () => {
    const p = P3;
    expect(iggyPushAt(p, p.breathAt - 1)).toBe(0);
    const after = p.stages.map((s) => iggyPushAt(p, s.at + 200));
    expect(after[1]!).toBeGreaterThan(after[0]!);
    expect(after[2]!).toBeGreaterThan(after[1]!);
    expect(iggyPushAt(p, p.peakAt)).toBeCloseTo(1, 5);
    expect(iggyPushAt(p, (p.peakAt + p.reboundAt) / 2)).toBeCloseTo(1, 5);
    const swing = Math.min(...Array.from({ length: 60 }, (_, i) => iggyPushAt(p, p.reboundAt + i * 5)));
    expect(swing).toBeLessThan(0);
  });

  it('the ward flattens harder each stage, FLEXES before the peak, and SLAMS outward after the hit-stop; IV is gone after', () => {
    const p = P3;
    const f = p.stages.map((s) => iggyWardAt(p, C, s.at + 200).flatten);
    expect(f[1]!).toBeGreaterThan(f[0]!);
    expect(f[2]!).toBeGreaterThan(f[1]!);
    expect(iggyWardAt(p, C, p.peakAt).flatten).toBeGreaterThan(p.flatten);
    expect(iggyWardAt(p, C, p.reboundAt - 1).slam).toBe(0);
    expect(iggyWardAt(p, C, p.reboundAt + 1).slam).toBeGreaterThan(0.9);
    expect(iggyWardAt(P4, C, P4.reboundAt + 1).gone).toBe(true);
    expect(iggyWardAt(p, C, p.reboundAt + 1).gone).toBe(false);
  });

  it('the camera holds still through the hit-stop and jolts BACKWARD on the slam', () => {
    const p = P4;
    const dir = { x: 1, y: 0 };
    const a = iggyCameraAt(p, C, p.peakAt, dir), b = iggyCameraAt(p, C, p.reboundAt - 1, dir);
    expect(b).toEqual(a);
    expect(iggyCameraAt(p, C, p.reboundAt + 8, dir).x).toBeLessThan(a.x);
  });

  it('the stream runs from the attacker\'s rim to the target', () => {
    const s = iggyStream(A, D, 80, 80);
    expect(Math.hypot(s.mouth.x - A.x, s.mouth.y - A.y)).toBeCloseTo(72, 3);
    expect(s.length).toBeLessThan(Math.hypot(D.x - A.x, D.y - A.y));
    expect(Math.hypot(s.dir.x, s.dir.y)).toBeCloseTo(1, 6);
  });
});

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });
  const run = (total: number, values: number[], extra: Partial<HeroIggyOptions> = {}) => {
    let tick: ((dt: number) => void) | null = null;
    const onImpact = vi.fn(), onDone = vi.fn();
    const h = playHeroIggy({
      formation: formationOf(values, total), total, side: 'player', attacker: A, defender: D, reduced: false, onImpact, onDone,
      frames: (fn) => { tick = fn; return () => { tick = null; }; }, sound: false, safety: false, host: document.body, camera: null,
      mount: () => () => {}, textures: TEX, ...extra,
    });
    const step = (ms: number): void => { for (let t = 0; t < ms; t += 16) tick?.(16); };
    return { h, onImpact, onDone, step };
  };

  it('the consequence lands exactly ONCE, on the impact (never on a stage tick or the slam)', () => {
    const { h, onImpact, onDone, step } = run(14, [3, 3, 3, 3, 2]);
    step(h.plan.reboundAt + 20);
    expect(onImpact).not.toHaveBeenCalled();
    step(h.plan.impactAt - h.plan.reboundAt + 40);
    expect(onImpact).toHaveBeenCalledTimes(1);
    step(h.plan.endAt + 3000);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('the scene draws the ward, the presence, the breath, freezes for the hit-stop, and drains to nothing; IV too', () => {
    for (const [total, values] of [[3, [2, 1]], [40, [6, 6, 6, 6, 6, 5, 5]]] as const) {
      const { h, step } = run(total, [...values]);
      const sc = h.scene!;
      step(h.plan.breathAt - 100);
      expect(sc.wardUp).toBe(true);
      expect(sc.liveMotes).toBeGreaterThan(0);
      step(h.plan.stages[0]!.hitAt - h.plan.breathAt + 120);
      expect(sc.breathing).toBe(true);
      expect(sc.litRings).toBeGreaterThan(0);
      expect(sc.liveSprites).toBeLessThanOrEqual(MAX_IGGY_SPRITES + MAX_IGGY_PARTICLES + MAX_WING_PARTICLES);
      while (h.elapsed() < h.plan.peakAt) step(16);
      expect(sc.isFrozen).toBe(true);
      step(h.plan.endAt + 4000);
      expect(h.done).toBe(true);
    }
  });

  it('finish lands the blow once and cleans up; cancel never lands it', () => {
    const a = run(8, [3, 3, 2]);
    a.step(200);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    const b = run(8, [3, 3, 2]);
    b.step(200);
    b.h.cancel();
    b.step(5000);
    expect(b.onImpact).not.toHaveBeenCalled();
  });
});

describe('the headless scene', () => {
  it('stays bounded through a full Tier IV and destroy leaves nothing', () => {
    const sc = new HeroIggyScene(TEX, COLORS, LOOK, 1, 7);
    const root = new Container();
    root.addChild(sc.root);
    sc.wardUpAt(A.x, A.y, 100, { x: 1, y: 0 });
    sc.rise(A.x, A.y, 80, { x: 1, y: 0 }, 800);
    for (let i = 0; i < 50; i++) { sc.setPresence(i / 50, 0); sc.update(16); }
    sc.startStream({ x: 280, y: 850 }, { x: 1400, y: 200 }, 80, 1.5);
    for (const lv of [1, 2, 3]) {
      sc.shiftStream({ heat: 0.5 + lv * 0.15, width: 1.5, rate: 1, level: lv, top: lv === 3, gustMs: 160 });
      for (let i = 0; i < 20; i++) { sc.setStream(Math.min(1, i / 10)); sc.setWard(1, 0.1 * lv, lv); sc.update(16); }
    }
    expect(sc.litRings).toBe(3);
    sc.freeze(80);
    const t0 = sc.time;
    sc.update(16); sc.update(16);
    expect(sc.time).toBe(t0);
    sc.slam({ shatter: true, R: 100, size: 2, screen: 1920 });
    expect(sc.wardUp).toBe(false);
    for (let i = 0; i < 12; i++) { sc.setSurge(i / 12); sc.update(16); }
    sc.impact(D.x, D.y, 80, { size: 1.5, big: true, dir: { x: 1, y: -0.5 }, flashAlpha: 0.8, embers: 40, lingerMs: 600 });
    sc.fadePresence();
    let peak = 0;
    for (let i = 0; i < 400 && sc.update(16); i++) peak = Math.max(peak, sc.liveSprites);
    expect(peak).toBeLessThanOrEqual(MAX_IGGY_SPRITES + MAX_IGGY_PARTICLES + MAX_WING_PARTICLES);
    expect(sc.update(16)).toBe(false);
    sc.destroy();
    expect(root.children.length).toBe(0);
  });
});

describe('the tuner config', () => {
  it('clamps junk to the defaults, keeps colours hex, and Copy JSON drops the preview keys', () => {
    expect(clampHeroIggyValue('t1Stages', 99)).toBe(3);
    expect(clampHeroIggyValue('hitStopMs', -5)).toBe(0);
    expect(clampHeroIggyValue('colorWard', 'nope')).toBe(C.colorWard);
    expect(sanitizeHeroIggyConfig({ wardRadius: 'x', bogus: 1 })).toEqual(C);
    expect(JSON.parse(heroIggyConfigJson(C)).previewDamage).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    expect((SPEC.actions ?? []).some((a) => a.label.includes('Knockout'))).toBe(true);
  });
});

describe('the cosmetic', () => {
  it('Iggy Blast (attack_iggy_blast) is a Legendary crate hero attack that plays the iggy style; the dev override can force it', () => {
    const def = COSMETIC_INDEX['attack_iggy_blast']!;
    expect(def).toBeDefined();
    expect(def.name).toBe('Iggy Blast');
    expect(def.category).toBe('hero_attack');
    expect(def.rarity).toBe('legendary');
    expect(def.acquisition).toEqual({ type: 'crate' });
    expect(def.assets.style).toBe('iggy');
    expect(cosmeticOf('attack_iggy_blast')?.active).toBe(true);
    expect(styleOfCosmetic('attack_iggy_blast')).toBe('iggy');
    expect(HERO_ATTACK_STYLES).toContain('iggy');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('iggy');
    expect(resolveHeroAttackStyle({ attacker: 'player', attackerCosmeticId: 'attack_iggy_blast', devChoice: 'auto' })).toBe('iggy');
    expect(resolveHeroAttackStyle({ attacker: 'player', attackerCosmeticId: 'attack_nope', devChoice: 'auto' })).toBe('classic');
  });
});
