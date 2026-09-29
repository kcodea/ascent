// @vitest-environment jsdom
/**
 * THE COIN FLICK HERO ATTACK (a Rare; owner 2026-09-29: "rare and epics should only have 2 or 3 tiers to them and
 * generally be less exciting, but still extremely clean and fun"): the shared tiers mapped onto TWO visual tiers (I-II
 * small, III-IV big, a knockout big); the tuner values; the pure plan (one ping small; a ricochet volley big, the ticks
 * before THE impact); the pure path (released at the thrower, pings on the struck face clear of the big -N); the runner
 * on the shared clock (the blow lands exactly ONCE, on the last ping; both directions; replay; finish / cancel; cleanup;
 * the camera applied once); the headless scene (pooled, bounded, drains, destroy leaves nothing); the cosmetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  HERO_COIN_DEFAULTS, HERO_COIN_RANGES, clampHeroCoinValue, coinCameraAt, coinCues, coinLevel, coinPath, coinPlan, coinPos,
  heroCoinConfigJson, sanitizeHeroCoinConfig, type HeroCoinConfig, type HeroCoinNumKey,
} from './heroCoinConfig';
import { HeroCoinScene, MAX_COIN_SPRITES, type HeroCoinTextures } from './heroCoinScene';
import { playHeroCoin, type HeroCoinOptions } from './heroCoin';
import { SPEC } from '../HeroCoinTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroCoinTextures = { glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W, coinFace: W, coinShine: W };
const C = HERO_COIN_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean } = {}) => coinPlan({ total, distance: 1600, leadIn: leadInOf([total], o.reduced), ...o }, C);
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const R = 80;

describe('the tiers: the shared four onto a Rare\'s two', () => {
  it('uses the shared thresholds, and maps I-II to small, III-IV to big', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const p = plan(d);
      expect(p.tier, `dmg ${d}`).toBe(tierOf(d));
      expect(p.level, `dmg ${d}`).toBe(tierOf(d) >= 3 ? 'big' : 'small');
    }
    expect([1, 2, 3, 4].map((t) => coinLevel(t as 1 | 2 | 3 | 4))).toEqual(['small', 'small', 'big', 'big']);
  });

  it('a knockout plays big whatever the number', () => {
    const p = plan(3, { knockout: true });
    expect(p.tier).toBe(4);
    expect(p.level).toBe('big');
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_COIN_RANGES)) {
      const v = C[k as HeroCoinNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorGold', 'colorAmber', 'colorShine', 'colorDeep', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroCoinValue('bigPings', 99)).toBe(5);
    expect(clampHeroCoinValue('coinPx', -3)).toBe(16);
    expect(clampHeroCoinValue('coinPx', 'abc')).toBe(C.coinPx);
    expect(clampHeroCoinValue('colorGold', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroCoinValue('colorGold', 'gold')).toBe(C.colorGold);
    expect(clampHeroCoinValue('nope' as keyof HeroCoinConfig, 1)).toBeUndefined();
    const s = sanitizeHeroCoinConfig({ bigShower: 400, bogus: 1 });
    expect(s.bigShower).toBe(16);
    expect('bogus' in s).toBe(false);
  });

  it('every config key has a control; Copy JSON drops the preview keys; the buttons sit on top; the style row offers coin', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroCoinConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.bigPings).toBe(3);
    expect(SPEC.buttonsOnTop).toBe(true);
    expect(SPEC.controls.find((c) => c.key === 'attackStyle')?.options).toContain('coin');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('coin');
    expect((SPEC.actions ?? []).map((a) => a.label).filter((l) => /speed|reduced/i.test(l))).toEqual([]);
  });
});

describe('the plan', () => {
  it('SMALL: one ping, and it IS the impact (no ticks); short (a Rare)', () => {
    const p = plan(3);
    expect(p.pings).toHaveLength(1);
    expect(p.hits).toEqual([]);
    expect(p.impactAt).toBe(p.pings[0]);
    expect(p.shower).toBe(0);
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(1600);
    const kinds = coinCues(p).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(0);
  });

  it('BIG: a ricochet volley, the pings before the last are ticks, the last is THE impact and it showers', () => {
    const p = plan(14);
    expect(p.pings).toHaveLength(3);
    expect(p.hits).toEqual(p.pings.slice(0, 2));
    expect(p.impactAt).toBe(p.pings[2]);
    expect(p.shower).toBeGreaterThan(0);
    for (let i = 1; i < p.pings.length; i++) expect(p.pings[i]!).toBeGreaterThan(p.pings[i - 1]!);
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(2200);
    const kinds = coinCues(p).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(2);
    expect(kinds.lastIndexOf('hit')).toBeLessThan(kinds.indexOf('impact'));
  });

  it('reduced motion: no coin; the blow lands at the end of the formation', () => {
    const p = plan(14, { reduced: true });
    expect(p.reduced).toBe(true);
    expect(p.impactAt).toBe(leadInOf([14], true));
    expect(coinPath(p, A, D, R, R, 0.15)).toEqual({ legs: [], contacts: [], arrive: [] });
  });

  it('is deterministic', () => {
    expect(plan(14)).toEqual(plan(14));
    expect(coinPath(plan(14), A, D, R, R, 0.15)).toEqual(coinPath(plan(14), A, D, R, R, 0.15));
  });
});

describe('the path', () => {
  it('released at the thrower, every ping on the struck face, the arc never above the ceiling, clear of the -N', () => {
    const p = plan(40);
    const avoid = { x: D.x - 200, y: D.y + 100 };
    const path = coinPath(p, A, D, R, R, 0.16, 20, avoid, 1.2);
    expect(Math.hypot(path.legs[0]!.a.x - A.x, path.legs[0]!.a.y - A.y)).toBeLessThanOrEqual(R);
    for (const c of path.contacts) expect(Math.hypot(c.x - D.x, c.y - D.y)).toBeLessThanOrEqual(R * 0.5);
    // the last ping is swung away from where the big -N pops
    const last = path.contacts[path.contacts.length - 1]!;
    const toAvoid = Math.atan2(avoid.y - D.y, avoid.x - D.x), toLast = Math.atan2(last.y - D.y, last.x - D.x);
    expect(Math.abs(Math.atan2(Math.sin(toAvoid - toLast), Math.cos(toAvoid - toLast)))).toBeGreaterThan(0.3);
    for (let t = 0; t <= p.flightMs; t += 10) expect(coinPos(path, t).y).toBeGreaterThanOrEqual(20 - 1);
    // the path ends on each ping at its beat
    for (let i = 0; i < p.pings.length; i++) {
      const at = coinPos(path, p.pings[i]! - p.flickAt);
      expect(Math.hypot(at.x - path.contacts[i]!.x, at.y - path.contacts[i]!.y)).toBeLessThan(1);
    }
  });

  it('the camera pushes in through the ready and settles after the impact', () => {
    const p = plan(14);
    expect(coinCameraAt(p, C, p.chargeAt - 10).zoom).toBe(1);
    expect(coinCameraAt(p, C, p.flickAt).zoom).toBeGreaterThan(1);
    expect(coinCameraAt(p, C, p.impactAt + 3000).zoom).toBeCloseTo(1, 3);
  });
});

function manualFrames(): { frames: HeroCoinOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroCoinOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroCoin({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, defenderRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('BIG: the blow lands EXACTLY ONCE, on the last ping, never on a ricochet; everything is put back', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(h.plan.level).toBe('big');
    expect(host.querySelector('.hblast.hcoin')).not.toBeNull();
    f.tick(h.plan.hits[1]! + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.flying).toBe(true);
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.hasCoin).toBe(false); // burst into the shower
    expect(h.scene!.liveFx).toBeGreaterThan(h.plan.shower);
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('translate(');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(4000, 16);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('SMALL: one ping lands the blow and the coin caroms off', () => {
    const { h, f, onImpact } = run({ total: 3, formation: formationOf([3], 3) });
    expect(h.plan.level).toBe('small');
    f.tick(h.plan.impactAt + 40, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.hasCoin).toBe(true);
    expect(h.scene!.flying).toBe(false); // caroming
    f.tick(h.plan.endAt + 3000, 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(f.hooked()).toBe(0);
  });

  it('works in both directions at every tier, within the sprite cap', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.impactAt + 400; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_COIN_SPRITES);
        for (const c of h.path.contacts) expect(Math.hypot(c.x - d.x, c.y - d.y)).toBeLessThanOrEqual(R * 0.5);
        h.cancel();
      }
    }
  });

  it('the camera is applied ONCE: the Pixi root stays at rest when the canvas already rides the camera element', () => {
    const camera = document.createElement('div');
    camera.appendChild(document.createElement('canvas'));
    const { h, f, root } = run({ camera, total: 40, formation: formationOf([40], 40) });
    f.tick(h.plan.impactAt + 20, 4);
    expect(h.mirrorsCamera).toBe(false);
    expect(camera.style.transform).toContain('scale(');
    const layer = root.children[0] as Container;
    expect(layer.scale.x).toBe(1);
    expect(layer.position.x).toBe(0);
    h.cancel();
    const b = run({ total: 40, formation: formationOf([40], 40) }); // a bare camera (no canvas inside): mirrored
    b.f.tick(b.h.plan.flickAt + 20, 4);
    expect(b.h.mirrorsCamera).toBe(true);
    b.h.cancel();
  });

  it('finish() lands once; cancel() never lands; a replay plays the same', () => {
    const a = run();
    a.f.tick(200, 16);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
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
    expect(x.h.path).toEqual(y.h.path);
    x.f.tick(x.h.plan.impactAt + 60, 8); y.f.tick(y.h.plan.impactAt + 60, 8);
    expect(x.h.scene!.liveSprites).toBe(y.h.scene!.liveSprites);
    x.h.cancel(); y.h.cancel();
  });

  it('reduced motion: no scene, no camera; the blow still lands once', () => {
    const { h, f, onImpact, camera } = run({ reduced: true });
    expect(h.scene).toBeNull();
    f.tick(h.plan.endAt + 100, 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(camera.style.transform).toBe('');
  });
});

describe('the scene (headless Pixi)', () => {
  it('pools, stays under the cap, drains, and destroy leaves nothing', () => {
    const scene = new HeroCoinScene(TEX, { gold: 0xffc93c, amber: 0xff9a1f, shine: 0xfff4c2, deep: 0x8a5a12, side: 0xffd76a },
      { px: 46, ghosts: 3, ghostMs: 24, glint: 0.9, ping: 1, caromMs: 560, showerSpeed: 560, showerGravity: 1500 }, 1, 7);
    const p = plan(40);
    const path = coinPath(p, A, D, R, R, 0.16);
    scene.startCharge(path.legs[0]!.a, 200);
    for (let i = 0; i < 10; i++) scene.update(16);
    scene.flick(path, 1, 5);
    for (let t = 0; t < p.impactAt - p.flickAt; t += 16) scene.update(16);
    scene.impact(path.contacts[2]!, path.arrive[2]!, { big: true, shower: 16, sparkles: 30 });
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_COIN_SPRITES);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    expect(scene.liveSprites).toBe(0);
    const pooled = scene.pooledSprites;
    scene.flick(path, 1, 5);
    expect(scene.pooledSprites).toBe(pooled); // reused, not grown
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });
});

describe('the cosmetic', () => {
  it('Pocket Change (attack_coin) is a RARE crate hero attack that plays the coin; the dev override can force it', () => {
    expect(COSMETIC_INDEX.attack_coin).toMatchObject({ category: 'hero_attack', rarity: 'rare', name: 'Pocket Change', assets: { style: 'coin' }, active: true });
    expect(COSMETIC_INDEX.attack_coin!.name.length).toBeLessThanOrEqual(20);
    expect(HERO_ATTACK_STYLES).toContain('coin');
    expect(styleOfCosmetic('attack_coin')).toBe('coin');
    expect(resolveHeroAttackStyle({ attacker: 'player', attackerCosmeticId: 'attack_coin', devChoice: 'auto' })).toBe('coin');
    expect(resolveHeroAttackStyle({ attacker: 'opp', attackerCosmeticId: null, devChoice: 'coin' })).toBe('coin');
    expect(styleOfCosmetic('attack_fire')).toBe('fire');
  });
});
