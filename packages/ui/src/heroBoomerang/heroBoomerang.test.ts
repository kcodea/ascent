// @vitest-environment jsdom
/**
 * THE BOOMERANG HERO ATTACK (a Rare; owner 2026-09-29): the shared tiers on TWO visual tiers (I-II small, III-IV big, a
 * knockout big); the tuner values; the pure plan (one boomerang small; two on crossing paths big, a double thwack, the
 * first a tick, the second THE impact, both caught AFTER the blow); the pure flight (out to the face, home to the hand,
 * the pair crossing); the runner on the shared clock (the blow lands exactly ONCE; both directions; replay; finish /
 * cancel; cleanup; the camera applied once); the headless scene; the cosmetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  HERO_BOOMERANG_DEFAULTS, HERO_BOOMERANG_RANGES, boomerangCues, boomerangLevel, boomerangMotions, boomerangPlan, boomerangPos,
  clampHeroBoomerangValue, heroBoomerangConfigJson, type HeroBoomerangNumKey,
} from './heroBoomerangConfig';
import { HeroBoomerangScene, MAX_BOOMERANG_SPRITES, type HeroBoomerangTextures } from './heroBoomerangScene';
import { playHeroBoomerang, type HeroBoomerangOptions } from './heroBoomerang';
import { SPEC } from '../HeroBoomerangTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroBoomerangTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W, boomBody: W, boomInlay: W, boomWhirl: W, chip: W, burst: W,
};
const C = HERO_BOOMERANG_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean } = {}) => boomerangPlan({ total, distance: 1600, leadIn: leadInOf([total], o.reduced), ...o }, C);
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const R = 80;

/** Do segments p1-p2 and q1-q2 cross? */
function crosses(p1: { x: number; y: number }, p2: { x: number; y: number }, q1: { x: number; y: number }, q2: { x: number; y: number }): boolean {
  const o = (a: typeof p1, b: typeof p1, c: typeof p1): number => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return o(p1, p2, q1) !== o(p1, p2, q2) && o(q1, q2, p1) !== o(q1, q2, p2);
}

describe('the tiers: the shared four onto a Rare\'s two', () => {
  it('uses the shared thresholds; I-II small, III-IV big; a knockout big', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).level, `dmg ${d}`).toBe(tierOf(d) >= 3 ? 'big' : 'small');
    expect([1, 2, 3, 4].map((t) => boomerangLevel(t as 1 | 2 | 3 | 4))).toEqual(['small', 'small', 'big', 'big']);
    expect(plan(2, { knockout: true })).toMatchObject({ tier: 4, level: 'big' });
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; buttons on top', () => {
    for (const [k, [min, max]] of Object.entries(HERO_BOOMERANG_RANGES)) {
      const v = C[k as HeroBoomerangNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroBoomerangValue('bigCount', 9)).toBe(2);
    expect(clampHeroBoomerangValue('colorTeal', 'teal')).toBe(C.colorTeal);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroBoomerangConfigJson(C)).previewParts).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    expect(DEV_HERO_ATTACK_CHOICES).toContain('boomerang');
  });
});

describe('the plan', () => {
  it('SMALL: one boomerang, the thwack IS the impact, the catch comes after; short (a Rare)', () => {
    const p = plan(3);
    expect(p.throws).toHaveLength(1);
    expect(p.hits).toEqual([]);
    expect(p.impactAt).toBe(p.throws[0]!.arriveAt);
    expect(p.catches[0]!).toBeGreaterThan(p.impactAt);
    expect(p.endAt).toBeGreaterThan(p.catches[0]!);
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(1800);
  });

  it('BIG: two, a double thwack (a tick then THE impact), both caught after the blow', () => {
    const p = plan(14);
    expect(p.throws).toHaveLength(2);
    expect(p.hits).toEqual([p.throws[0]!.arriveAt]);
    expect(p.impactAt).toBe(p.throws[1]!.arriveAt);
    expect(p.impactAt - p.hits[0]!).toBeGreaterThanOrEqual(90);
    for (const at of p.catches) expect(at).toBeGreaterThan(p.impactAt);
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(2200);
    const kinds = boomerangCues(p).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'catch')).toHaveLength(2);
    expect(kinds.indexOf('hit')).toBeLessThan(kinds.indexOf('impact'));
  });

  it('reduced motion: no flight; the blow lands at the end of the formation', () => {
    const p = plan(14, { reduced: true });
    expect(p.impactAt).toBe(leadInOf([14], true));
    expect(boomerangMotions(p, A, D, R, R)).toEqual([]);
  });
});

describe('the flight', () => {
  it('out from the thrower to the face, home to the same hand; the pair crosses mid-flight', () => {
    const p = plan(40);
    const ms = boomerangMotions(p, A, D, R, R, 20, null);
    expect(ms).toHaveLength(2);
    for (const m of ms) {
      expect(Math.hypot(m.rel.x - A.x, m.rel.y - A.y)).toBeLessThanOrEqual(R * 1.2);
      expect(Math.hypot(m.hit.x - D.x, m.hit.y - D.y)).toBeLessThanOrEqual(R * 0.5);
      const at = boomerangPos(m, m.outMs);
      expect(Math.hypot(at.x - m.hit.x, at.y - m.hit.y)).toBeLessThan(1);
      const home = boomerangPos(m, m.outMs + m.backMs + 50);
      expect(home).toEqual(m.rel);
    }
    // the two outward paths cross (an X), sampled as polylines
    const pts = (m: typeof ms[number]) => Array.from({ length: 21 }, (_, i) => boomerangPos(m, (m.outMs * i) / 20));
    const a = pts(ms[0]!), b = pts(ms[1]!);
    let x = false;
    for (let i = 0; i < 20 && !x; i++) for (let j = 0; j < 20 && !x; j++) x = crosses(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!);
    expect(x).toBe(true);
    expect(Math.hypot(ms[0]!.hit.x - ms[1]!.hit.x, ms[0]!.hit.y - ms[1]!.hit.y)).toBeGreaterThan(R * 0.4); // two spots
  });
});

function manualFrames(): { frames: HeroBoomerangOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroBoomerangOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroBoomerang({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, defenderRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('BIG: the blow lands ONCE on the second thwack, never the first; both are caught; everything is put back', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(host.querySelector('.hblast.hboomerang')).not.toBeNull();
    f.tick(h.plan.hits[0]! + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.flyingBooms).toBe(2);
    expect(h.scene!.liveTrails).toBeGreaterThan(0);
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(h.plan.catches[1]! - h.elapsed() + 20, 4);
    expect(h.scene!.flyingBooms).toBe(0); // both caught
    expect(attackerEl.style.transform).toContain('scale(');
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(3000, 16);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('both directions at every tier, within the cap; the camera applied once when the canvas rides it', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.endAt; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_BOOMERANG_SPRITES);
        h.cancel();
      }
    }
    const camera = document.createElement('div');
    camera.appendChild(document.createElement('canvas'));
    const { h, f, root } = run({ camera, total: 40, formation: formationOf([40], 40) });
    f.tick(h.plan.impactAt + 20, 4);
    expect(h.mirrorsCamera).toBe(false);
    expect((root.children[0] as Container).scale.x).toBe(1);
    h.cancel();
  });

  it('finish() lands once; cancel() never lands; a replay plays the same; reduced motion lands once', () => {
    const a = run();
    a.f.tick(200, 16);
    a.h.finish();
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    const b = run();
    b.f.tick(200, 16);
    b.h.cancel();
    expect(b.onImpact).not.toHaveBeenCalled();
    expect(b.f.hooked()).toBe(0);
    const x = run({ total: 40, formation: formationOf([40], 40) });
    const y = run({ total: 40, formation: formationOf([40], 40) });
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.motions).toEqual(y.h.motions);
    x.h.cancel(); y.h.cancel();
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
  });
});

describe('the scene (headless Pixi)', () => {
  it('pools, stays under the cap, drains, and destroy leaves nothing', () => {
    const scene = new HeroBoomerangScene(TEX, { wood: 0xd0914f, grain: 0x6b3f1d, teal: 0x2de0c8, tealDeep: 0x0f7f86, flash: 0xf4fffb, side: 0x7fffe6 },
      { px: 74, trailMs: 120, trailWidth: 12, whirl: 0.3, thwack: 1, catchMs: 180 }, 1, 3);
    const p = plan(40);
    const ms = boomerangMotions(p, A, D, R, R);
    ms.forEach((m, i) => scene.throw(m, 1, 5, i));
    for (let t = 0; t < ms[0]!.outMs; t += 16) scene.update(16);
    ms.forEach((m, i) => scene.thwack(i, m.hit, m.arrive, 1.25, 24));
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_BOOMERANG_SPRITES);
    for (let t = 0; t < ms[0]!.backMs; t += 16) scene.update(16);
    ms.forEach((_, i) => scene.catchAt(i));
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    expect(scene.liveSprites).toBe(0);
    expect(scene.liveTrails).toBe(0);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });
});

describe('the cosmetic', () => {
  it('Come Back Around (attack_boomerang) is a RARE crate hero attack that plays the boomerang', () => {
    expect(COSMETIC_INDEX.attack_boomerang).toMatchObject({ category: 'hero_attack', rarity: 'rare', name: 'Come Back Around', assets: { style: 'boomerang' }, active: true });
    expect(COSMETIC_INDEX.attack_boomerang!.name.length).toBeLessThanOrEqual(20);
    expect(HERO_ATTACK_STYLES).toContain('boomerang');
    expect(styleOfCosmetic('attack_boomerang')).toBe('boomerang');
  });
});
